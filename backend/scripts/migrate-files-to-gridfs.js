import fsPromises from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { createGridFsStorage } from "../src/storage.js";

/*
 * Copie dans GridFS les fichiers des pistes créées quand l'audio et les
 * pochettes étaient stockés sur le disque (data/uploads). Chaque membre du
 * binôme lance ce script une fois sur sa machine : seuls les fichiers
 * présents sur son disque peuvent être migrés.
 *
 *   npm run migrate:gridfs
 *
 * Le script peut être relancé sans risque : une piste déjà migrée (fileId
 * présent) est ignorée.
 */
const UPLOADS = path.resolve("data/uploads");
const COVERS = path.join(UPLOADS, "covers");

/** Lit un fichier local, ou retourne null s'il n'existe pas sur cette machine. */
async function readLocal(filePath) {
  try {
    return await fsPromises.readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  const error = new Error("MONGODB_URI manque dans backend/.env");
  console.error("[migrate] Configuration MongoDB absente", error);
  throw error;
}

await mongoose.connect(uri);
console.log("[migrate] Connecté à MongoDB");

const storage = createGridFsStorage();
// La collection est lue directement car les anciens champs (storedName,
// coverStoredName) ne font plus partie du schéma Mongoose.
const tracks = mongoose.connection.db.collection("tracks");
const legacy = await tracks
  .find({ storedName: { $exists: true }, fileId: { $exists: false } })
  .toArray();
console.log(`[migrate] ${legacy.length} piste(s) à migrer`);

let migrated = 0;
let missing = 0;
try {
  for (const track of legacy) {
    const audio = await readLocal(path.join(UPLOADS, track.storedName));
    if (!audio) {
      console.warn(`[migrate] ${track._id} « ${track.title} » : audio absent de ce disque (uploadé depuis une autre machine ?)`);
      missing += 1;
      continue;
    }

    const fileId = await storage.save(audio, {
      filename: track.originalName,
      contentType: track.mimeType,
    });
    const set = { fileId };
    const unset = { storedName: "", coverStoredName: "" };

    const cover = track.coverStoredName
      ? await readLocal(path.join(COVERS, track.coverStoredName))
      : null;
    if (cover) {
      set.coverFileId = await storage.save(cover, {
        filename: track.coverStoredName,
        contentType: track.coverMimeType,
      });
    } else {
      // Sans fichier, la pochette est retirée pour que hasCover devienne false.
      unset.coverMimeType = "";
    }

    await tracks.updateOne({ _id: track._id }, { $set: set, $unset: unset });
    console.log(`[migrate] ${track._id} « ${track.title} » migrée (pochette : ${Boolean(cover)})`);
    migrated += 1;
  }
} catch (error) {
  console.error("[migrate] Migration interrompue", error);
  throw error;
} finally {
  console.log(`[migrate] Terminé : ${migrated} migrée(s), ${missing} sans fichier sur ce disque`);
  await mongoose.disconnect();
}
