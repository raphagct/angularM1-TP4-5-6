import mongoose from "mongoose";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/*
 * Les octets des fichiers (audio et pochettes) sont stockés dans MongoDB avec
 * GridFS, et non plus sur le disque du serveur : ainsi, tous les backends
 * connectés à la même base Atlas peuvent lire les fichiers des autres.
 * GridFS découpe chaque fichier en morceaux de 255 Ko (collection
 * <bucket>.chunks) et garde sa description dans <bucket>.files.
 * Documentation : https://www.mongodb.com/docs/drivers/node/current/crud/gridfs/
 *
 * Le stockage expose quatre fonctions, ce qui permet aux tests de le
 * remplacer par une version en mémoire (createApp({ storage })).
 */
export function createGridFsStorage(bucketName = "uploads") {
  // Le bucket est créé à la demande : server.js ouvre la connexion MongoDB
  // avant d'accepter la première requête.
  const bucket = () =>
    new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName });

  return {
    /** Enregistre un Buffer et retourne l'identifiant GridFS du fichier. */
    async save(buffer, { filename, contentType }) {
      const upload = bucket().openUploadStream(filename, {
        metadata: { contentType },
      });
      await pipeline(Readable.from([buffer]), upload);
      console.log(`[storage] Fichier enregistré dans GridFS : ${upload.id}`);
      return upload.id;
    },

    /** Retourne la taille du fichier, ou null s'il n'existe pas. */
    async info(id) {
      const [file] = await bucket().find({ _id: id }).limit(1).toArray();
      return file ? { length: file.length } : null;
    },

    /** Ouvre un flux de lecture ; `end` est exclusif, comme dans GridFS. */
    stream(id, range = {}) {
      return bucket().openDownloadStream(id, range);
    },

    /** Supprime le fichier ; lève une erreur s'il n'existe pas. */
    async remove(id) {
      await bucket().delete(id);
      console.log(`[storage] Fichier supprimé de GridFS : ${id}`);
    },
  };
}
