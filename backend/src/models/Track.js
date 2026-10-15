import mongoose from "mongoose";

/*
 * Ce schéma conserve les métadonnées d'une piste. Le fichier audio lui-même
 * reste sur le disque ; storedName contient le nom technique utilisé côté
 * serveur et n'est jamais exposé par toPublic().
 */
const schema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    originalName: { type: String, required: true },
    storedName: { type: String, required: true, select: false },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true, min: 0 },
    // Métadonnées lues dans les tags du fichier ou saisies à l'upload.
    artist: { type: String, trim: true, maxlength: 200 },
    album: { type: String, trim: true, maxlength: 200 },
    genre: { type: String, trim: true, maxlength: 100 },
    year: { type: Number, min: 0, max: 9999 },
    // Informations techniques du flux audio.
    duration: { type: Number, min: 0 },
    bitrate: { type: Number, min: 0 },
    sampleRate: { type: Number, min: 0 },
    // La pochette est stockée sur le disque comme l'audio ; son nom technique
    // n'est jamais exposé. coverMimeType sert aussi à savoir si elle existe.
    coverStoredName: { type: String, select: false },
    coverMimeType: { type: String },
  },
  { timestamps: true },
);

// Cet index accélère la liste des pistes d'un utilisateur triées par date.
schema.index({ ownerId: 1, createdAt: -1 });

/**
 * Convertit un document (Mongoose ou objet `.lean()`) en objet sûr pour le
 * frontend. L'identifiant MongoDB devient la propriété simple `id` attendue
 * par Angular et les noms de stockage ne sont jamais renvoyés.
 */
schema.statics.publicFrom = function (doc) {
  return {
    id: String(doc._id),
    ownerId: String(doc.ownerId),
    title: doc.title,
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    size: doc.size,
    artist: doc.artist,
    album: doc.album,
    genre: doc.genre,
    year: doc.year,
    duration: doc.duration,
    bitrate: doc.bitrate,
    sampleRate: doc.sampleRate,
    hasCover: Boolean(doc.coverMimeType),
    createdAt: doc.createdAt,
  };
};

schema.methods.toPublic = function () {
  console.debug(`[track-model] Préparation de la piste publique ${this.id}`);
  return this.constructor.publicFrom(this);
};

export const Track = mongoose.model("Track", schema);
