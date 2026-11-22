import Foundation
import Photos
import Capacitor

/// DEXTER PhotoKit bridge for Capacitor 8. The plugin never reads image pixels,
/// uploads assets, duplicates assets, removes assets or deletes any photo.
@objc(DexterPhotoKitPlugin)
public class DexterPhotoKitPlugin: CAPPlugin, CAPBridgedPlugin, PHPhotoLibraryChangeObserver {
    public let identifier = "DexterPhotoKitPlugin"
    public let jsName = "DexterPhotoKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorizationStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAssetsPage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beginAssetScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endAssetScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listAlbums", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createAlbum", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isAlbumWritable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "areAssetsAccessible", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addExistingAssets", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "verifyAlbumMembership", returnType: CAPPluginReturnPromise)
    ]

    private let photoLibrary = PHPhotoLibrary.shared()
    private let maxPage = 250
    private let maxAlbumBatch = 250

    // One in-memory PHFetchResult per explicit scan. A page MUST use the same
    // fetch result and opaque token as every other page in that scan.
    // The serial queue protects both observer notifications and async reads.
    private struct AssetScanSession {
        let token: String
        let assets: PHFetchResult<PHAsset>
        var invalidated: Bool
    }
    private let scanStateQueue = DispatchQueue(label: "app.dexter.photokit.scan-state")
    private var activeScan: AssetScanSession?
    private var libraryRevision: UInt64 = 0

    public override func load() {
        super.load()
        photoLibrary.register(self)
    }

    deinit {
        photoLibrary.unregisterChangeObserver(self)
    }

    // Any Photos change invalidates a live scan conservatively, including
    // ordering/metadata edits which do not change the asset count.
    // No background processing is started and no user pixels are read.
    public func photoLibraryDidChange(_ changeInstance: PHChange) {
        scanStateQueue.sync {
            libraryRevision &+= 1
            if activeScan != nil { activeScan?.invalidated = true }
        }
    }

    private func scanFetchOptions() -> PHFetchOptions {
        let options = PHFetchOptions()
        // PhotoKit supports ordering by creationDate. Ties remain stable
        // within the retained PHFetchResult rather than across fresh fetches.
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        return options
    }

    private func statusName(_ status: PHAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .limited: return "limited"
        case .authorized: return "authorized"
        @unknown default: return "denied"
        }
    }

    private func hasFullAccess(_ call: CAPPluginCall) -> Bool {
        guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized else {
            call.reject("O DEXTER precisa de acesso completo às Fotografias. O acesso limitado não permite organizar toda a biblioteca.", "PHOTOS_FULL_ACCESS_REQUIRED")
            return false
        }
        return true
    }

    /// Validate identifiers to limit accidental/faulty app-side writes. A missing
    /// or duplicate PHAsset localIdentifier is never silently ignored.
    private func assetIds(_ call: CAPPluginCall) -> [String]? {
        guard let ids = call.getArray("assetIds", String.self),
              !ids.isEmpty, ids.count <= maxAlbumBatch,
              Set(ids).count == ids.count,
              ids.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 256 }) else {
            call.reject("A seleção PhotoKit deve conter de 1 a 250 identificadores únicos e válidos.", "INVALID_ASSET_SELECTION")
            return nil
        }
        return ids
    }

    private func regularAlbum(_ call: CAPPluginCall) -> PHAssetCollection? {
        guard let id = call.getString("albumId"), !id.isEmpty, id.utf8.count <= 256 else {
            call.reject("Identificador do álbum Apple inválido.", "INVALID_ALBUM_ID")
            return nil
        }
        guard let album = PHAssetCollection.fetchAssetCollections(
            withLocalIdentifiers: [id], options: nil
        ).firstObject,
        album.assetCollectionType == .album,
        album.assetCollectionSubtype == .albumRegular else {
            call.reject("Álbum Apple inexistente ou não editável (álbuns inteligentes/partilhados não são suportados).", "ALBUM_NOT_REGULAR")
            return nil
        }
        return album
    }

    private func fetchAssetsByID(_ ids: [String]) -> [String: PHAsset] {
        let fetched = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
        var byId: [String: PHAsset] = [:]
        byId.reserveCapacity(min(ids.count, fetched.count))
        for i in 0..<fetched.count {
            let item = fetched.object(at: i)
            byId[item.localIdentifier] = item
        }
        return byId
    }

    /// Enumerates an album without loading all IDs or any pixel data in memory.
    /// Stops as soon as every requested asset has been found.
    private func membership(in album: PHAssetCollection, ids: [String]) -> Set<String> {
        let wanted = Set(ids)
        var found = Set<String>()
        let fetched = PHAsset.fetchAssets(in: album, options: nil)
        for i in 0..<fetched.count {
            let id = fetched.object(at: i).localIdentifier
            if wanted.contains(id) { found.insert(id) }
            if found.count == wanted.count { break }
        }
        return found
    }

    @objc func authorizationStatus(_ call: CAPPluginCall) {
        call.resolve(["status": statusName(PHPhotoLibrary.authorizationStatus(for: .readWrite))])
    }

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        let current = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if current != .notDetermined {
            call.resolve(["status": statusName(current)])
            return
        }
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { [weak self] status in
            guard let self = self else {
                call.reject("A sessão PhotoKit terminou.", "PLUGIN_RELEASED")
                return
            }
            call.resolve(["status": self.statusName(status)])
        }
    }

    /// Explicit new session. This replaces any previous in-memory scan.
    /// The token is volatile: a process relaunch requires a fresh session.
    @objc func beginAssetScan(_ call: CAPPluginCall) {
        guard hasFullAccess(call) else { return }
        DispatchQueue.global(qos: .userInitiated).async {
            let startingRevision = self.scanStateQueue.sync { self.libraryRevision }
            let fetched = PHAsset.fetchAssets(with: self.scanFetchOptions())
            let token = UUID().uuidString
            let accepted = self.scanStateQueue.sync { () -> Bool in
                guard self.libraryRevision == startingRevision else { return false }
                self.activeScan = AssetScanSession(token: token, assets: fetched, invalidated: false)
                return true
            }
            guard accepted else {
                call.reject("A biblioteca mudou ao iniciar a leitura. Repete o início da análise.", "LIBRARY_CHANGED")
                return
            }
            call.resolve(["snapshotToken": token, "total": fetched.count])
        }
    }

    /// Frees the snapshot's resources; token mismatches cannot end another scan.
    @objc func endAssetScan(_ call: CAPPluginCall) {
        guard let token = call.getString("snapshotToken"), !token.isEmpty else {
            call.reject("Identificador da sessão PhotoKit inválido.", "INVALID_SCAN_TOKEN")
            return
        }
        let ended = scanStateQueue.sync { () -> Bool in
            guard activeScan?.token == token else { return false }
            activeScan = nil
            return true
        }
        if ended { call.resolve(["ended": true]) }
        else { call.reject("A sessão PhotoKit expirou ou foi substituída.", "SCAN_EXPIRED") }
    }

    /// The optional snapshotToken enables stable, change-detecting paging.
    /// Existing callers without a token keep the legacy metadata-only API,
    /// but MUST NOT claim a stable 10,000+ scan across library mutations.
    @objc func getAssetsPage(_ call: CAPPluginCall) {
        guard hasFullAccess(call) else { return }
        guard let offset = call.getInt("offset"), let limit = call.getInt("limit"),
              offset >= 0, limit >= 1, limit <= maxPage else {
            call.reject("Página PhotoKit inválida (limite máximo de 250).", "INVALID_PAGE")
            return
        }
        let requestedToken = call.getString("snapshotToken")
        DispatchQueue.global(qos: .userInitiated).async {
            let all: PHFetchResult<PHAsset>
            if let token = requestedToken {
                let current = self.scanStateQueue.sync { self.activeScan }
                guard let scan = current, scan.token == token, !scan.invalidated else {
                    call.reject("A sessão de leitura expirou ou a biblioteca mudou. Reinicia a análise.", "SCAN_EXPIRED")
                    return
                }
                all = scan.assets
            } else {
                // Backward compatible, but each legacy call has an independent fetch.
                all = PHAsset.fetchAssets(with: self.scanFetchOptions())
            }
            let total = all.count
            guard offset <= total else {
                call.reject("O total da biblioteca mudou. Reinicia o processamento.", "LIBRARY_CHANGED")
                return
            }
            let end = min(total, offset + limit)
            let dateFormatter = ISO8601DateFormatter()
            dateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            var page: [[String: Any]] = []
            page.reserveCapacity(end - offset)
            if end > offset {
                for index in offset..<end {
                    let asset = all.object(at: index)
                    let kind: String
                    switch asset.mediaType {
                    case .image: kind = "image"
                    case .video: kind = "video"
                    default: kind = "other"
                    }
                    var createdAt: Any = NSNull()
                    if let date = asset.creationDate {
                        createdAt = dateFormatter.string(from: date)
                    }
                    page.append([
                        "id": asset.localIdentifier,
                        "type": kind,
                        "createdAt": createdAt,
                        "width": asset.pixelWidth,
                        "height": asset.pixelHeight
                    ])
                }
            }
            if let token = requestedToken {
                let stillValid = self.scanStateQueue.sync {
                    self.activeScan?.token == token && self.activeScan?.invalidated == false
                }
                guard stillValid else {
                    call.reject("A biblioteca mudou durante a leitura. Nenhum progresso desta página foi confirmado.", "LIBRARY_CHANGED")
                    return
                }
            }
            call.resolve([
                "total": total,
                "nextOffset": end < total ? end as Any : NSNull(),
                "assets": page
            ])
        }
    }

    @objc func listAlbums(_ call: CAPPluginCall) {
        guard hasFullAccess(call) else { return }
        DispatchQueue.global(qos: .userInitiated).async {
            let albums = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .albumRegular, options: nil)
            var result: [[String: String]] = []
            result.reserveCapacity(albums.count)
            for i in 0..<albums.count {
                let album = albums.object(at: i)
                if let name = album.localizedTitle {
                    result.append(["id": album.localIdentifier, "title": name])
                }
            }
            call.resolve(["albums": result])
        }
    }

    @objc func createAlbum(_ call: CAPPluginCall) {
        guard hasFullAccess(call) else { return }
        guard let rawName = call.getString("title") else {
            call.reject("Indica o nome do álbum.", "INVALID_ALBUM_TITLE")
            return
        }
        let title = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty && title.count <= 80 else {
            call.reject("Nome do álbum inválido (máximo 80 caracteres).", "INVALID_ALBUM_TITLE")
            return
        }
        // Keep the new album ID in a box to avoid a captured mutable local across closures.
        let box = AlbumIdentifierBox()
        photoLibrary.performChanges({
            let create = PHAssetCollectionChangeRequest.creationRequestForAssetCollection(withTitle: title)
            box.value = create.placeholderForCreatedAssetCollection.localIdentifier
        }, completionHandler: { success, error in
            guard success, let albumId = box.value else {
                call.reject("Não foi possível criar o álbum Apple: \(error?.localizedDescription ?? "erro desconhecido")", "ALBUM_CREATE_FAILED")
                return
            }
            let verified = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [albumId], options: nil).firstObject
            guard verified?.localizedTitle == title else {
                call.reject("O álbum foi criado, mas não foi possível verificar o destino. Confirma na app Fotografias.", "ALBUM_CREATE_UNVERIFIED")
                return
            }
            call.resolve(["id": albumId])
        })
    }

    @objc func isAlbumWritable(_ call: CAPPluginCall) {
        guard hasFullAccess(call) else { return }
        guard let album = regularAlbum(call) else { return }
        call.resolve(["writable": album.canPerform(.addContent)])
    }

    @objc func areAssetsAccessible(_ call: CAPPluginCall) {
        guard hasFullAccess(call) else { return }
        guard let ids = assetIds(call) else { return }
        DispatchQueue.global(qos: .userInitiated).async {
            let fetched = self.fetchAssetsByID(ids)
            call.resolve(["accessible": fetched.count == ids.count])
        }
    }

    @objc func addExistingAssets(_ call: CAPPluginCall) {
        guard hasFullAccess(call) else { return }
        guard let album = regularAlbum(call), let ids = assetIds(call) else { return }
        guard album.canPerform(.addContent) else {
            call.reject("O álbum Apple não permite adicionar fotografias.", "ALBUM_READ_ONLY")
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let fetched = self.fetchAssetsByID(ids)
            guard fetched.count == ids.count else {
                call.reject("Algumas fotografias já não existem neste iPhone. Nada foi alterado.", "ASSET_NOT_FOUND")
                return
            }
            let presentBefore = self.membership(in: album, ids: ids)
            let toAdd = ids.filter { !presentBefore.contains($0) }.compactMap { fetched[$0] }
            if toAdd.isEmpty {
                call.resolve([
                    "requestedCount": ids.count,
                    "addedCount": 0,
                    "alreadyPresentCount": ids.count
                ])
                return
            }
            self.photoLibrary.performChanges({
                guard let request = PHAssetCollectionChangeRequest(for: album) else { return }
                // PhotoKit adds references to pre-existing PHAssets; no copy or deletion.
                request.addAssets(toAdd as NSArray)
            }, completionHandler: { success, error in
                guard success else {
                    call.reject("A Apple não concluiu a alteração: \(error?.localizedDescription ?? "erro desconhecido")", "ALBUM_ADD_FAILED")
                    return
                }
                let presentAfter = self.membership(in: album, ids: ids)
                guard presentAfter.count == ids.count else {
                    call.reject("A operação terminou, mas nem todas as fotos estão no álbum. Verifica Fotografias antes de repetir.", "ALBUM_ADD_UNVERIFIED")
                    return
                }
                call.resolve([
                    "requestedCount": ids.count,
                    "addedCount": toAdd.count,
                    "alreadyPresentCount": presentBefore.count
                ])
            })
        }
    }

    @objc func verifyAlbumMembership(_ call: CAPPluginCall) {
        guard hasFullAccess(call) else { return }
        guard let album = regularAlbum(call), let ids = assetIds(call) else { return }
        DispatchQueue.global(qos: .userInitiated).async {
            let present = self.membership(in: album, ids: ids)
            call.resolve([
                "complete": present.count == ids.count,
                "presentCount": present.count,
                "missingCount": ids.count - present.count
            ])
        }
    }
}

private final class AlbumIdentifierBox {
    var value: String?
}
