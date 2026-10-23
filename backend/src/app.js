import express from "express";
import cors from "cors";
import multer from "multer";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { User } from "./models/User.js";
import { Track } from "./models/Track.js";
import { extractMetadata, pickText, IMAGE_EXTENSIONS } from "./metadata.js";
import { createGridFsStorage } from "./storage.js";

// Les fichiers audio et les pochettes sont stockés dans MongoDB (GridFS) :
// tous les backends branchés sur la même base Atlas y ont accès.
// Le stockage peut être remplacé (tests) via createApp({ storage }).

// Ce secret reste côté serveur. Il ne doit jamais être copié dans Angular.
const SECRET = process.env.JWT_SECRET || "tp1-development-secret";

// La taille maximale d'un fichier audio est de 25 Mo. Les fichiers plus gros
// sont refusés par Multer avant d'être écrits sur le disque.
const MAX_FILE_SIZE = 25 * 1024 * 1024;

// Une pochette n'a pas besoin d'être aussi lourde qu'un fichier audio.
const MAX_COVER_SIZE = 5 * 1024 * 1024;

// Les types MIME autorisés correspondent aux formats demandés dans le sujet.
const allowed = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/mp4",
  "audio/x-m4a",
]);

// Types d'image acceptés pour une pochette envoyée par l'utilisateur.
const allowedCovers = new Set(["image/jpeg", "image/png", "image/webp"]);

export const AUDIO_FORMAT_ERROR = "Format audio non accepté";
export const COVER_FORMAT_ERROR = "Format d'image non accepté";

/**
 * Crée un jeton JWT contenant uniquement l'identité nécessaire à l'API.
 * Le mot de passe n'est jamais placé dans le token. `sub` signifie subject
 * et contient l'identifiant MongoDB de l'utilisateur.
 */
function token(user) {
  console.log(`[auth] Création d'un token pour l'utilisateur ${user.id}`);
  return jwt.sign({ sub: user.id, email: user.email }, SECRET, {
    expiresIn: "2h",
  });
}

/** Middleware Express qui protège les routes privées. */
function auth(req, res, next) {
  const raw = req.headers.authorization;

  // Le token est transmis dans l'en-tête Authorization sous la forme
    // "Authorization: Bearer <token>". Le préfixe "Bearer " est obligatoire pour que
    // le middleware sache qu'il s'agit d'un JWT et non d'un autre type de jeton.
  if (!raw?.startsWith("Bearer ")) {
    console.warn(`[auth] Authorization absente pour ${req.method} ${req.path}`);
    return res.status(401).json({ message: "Authentification requise" });
  }

  try {
    // jwt.verify vérifie la signature et la date d'expiration du token.
    // On ne logue jamais sa valeur, car un JWT permettrait une usurpation.
    req.auth = jwt.verify(raw.slice(7), SECRET);
    console.log(`[auth] Token accepté pour ${req.auth.sub}`);
    next();
  } catch (error) {
    console.error("[auth] Token invalide ou expiré", error);
    return res.status(401).json({ message: "Jeton invalide ou expiré" });
  }
}

/** Middleware qui refuse un identifiant MongoDB mal formé avant toute requête. */
function validId(req, res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    console.warn(`[tracks] Identifiant invalide : ${req.params.id}`);
    return res.status(404).json({ message: "Piste inconnue" });
  }
  next();
}

/**
 * Envoie un flux GridFS dans la réponse HTTP. Une erreur avant le premier
 * octet (fichier absent de la base) passe au gestionnaire d'erreurs ; après,
 * la connexion est coupée car le statut HTTP est déjà parti.
 */
function sendStream(stream, res, next, label) {
  stream.on("error", (error) => {
    console.error(`[tracks] Erreur d'envoi ${label}`, error);
    if (!res.headersSent) return next(error);
    res.destroy(error);
  });
  stream.on("end", () => console.log(`[tracks] Envoi terminé : ${label}`));
  stream.pipe(res);
}

/*
 * Multer transforme une requête HTTP multipart/form-data en données exploitables
 * par Express et traite les fichiers envoyés par un formulaire HTML.
 * Documentation officielle : https://github.com/expressjs/multer
 *
 * memoryStorage garde le fichier dans un Buffer (file.buffer) : il est ensuite
 * copié dans GridFS par le handler, une fois les validations passées. La
 * limite de 25 Mo borne la mémoire utilisée par requête.
 */
function createUpload() {
  /*
   * limits.fileSize protège le serveur contre les fichiers trop volumineux.
   * fileFilter est appelé avant l'enregistrement : accepter le fichier appelle
   * callback(null, true), le refuser transmet une vraie Error à Express.
   */
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (_request, file, callback) => {
      const accepted =
        file.fieldname === "cover" ? allowedCovers : allowed;
      if (accepted.has(file.mimetype)) {
        console.log(`[multer] Type accepté (${file.fieldname}) : ${file.mimetype}`);
        return callback(null, true);
      }

      const error = new Error(
        file.fieldname === "cover" ? COVER_FORMAT_ERROR : AUDIO_FORMAT_ERROR,
      );
      console.error(`[multer] Type refusé (${file.fieldname}) : ${file.mimetype}`, error);
      return callback(error);
    },
  });
}

/**
 * Construit l'application Express sans ouvrir de port.
 * Cette séparation permet au serveur réel et aux tests de créer la même
 * application. Le port est ouvert uniquement dans server.js.
 */
export function createApp({ storage = createGridFsStorage() } = {}) {
  const upload = createUpload();
  const app = express();

  /** Supprime un fichier stocké en journalisant l'échec, sans interrompre la requête. */
  async function removeQuietly(id) {
    try {
      await storage.remove(id);
    } catch (error) {
      console.error(`[tracks] Impossible de supprimer le fichier ${id}`, error);
    }
  }

  // Journaliser la fin de chaque requête permet de suivre méthode, URL,
  // statut et durée sans exposer les corps contenant des mots de passe.
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      console.log(
        `[http] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt} ms)`,
      );
    });
    next();
  });

  // CORS est nécessaire pour que le frontend Angular puisse appeler l'API.
  // C'est-à-dire que le navigateur autorise les requêtes cross-origin depuis localhost:4200.
  // Dans un vrai projet, il est recommandé de limiter les origines autorisées.
  app.use(cors());

  // Express ne gère pas nativement le JSON : ce middleware transforme le corps JSON en objet JavaScript 
  // accessible via req.body.
  // Il est placé avant les routes pour que toutes les requêtes JSON soient traitées.
  app.use(express.json());

  /** Endpoint public utilisé pour vérifier que l'API répond. */
  app.get("/api/health", (_req, res) => {
    console.log("[health] Vérification de l'API");
    res.json({ status: "ok" });
  });

  /** Requête POST pour "insertion" de donnée.
   * Inscrit un utilisateur et renvoie un token avec ses données publiques. 
   * @param {Object} req - La requête HTTP.
   * @param {Object} res - La réponse HTTP.
   * @param {Function} next - La fonction de middleware suivante.
   */
  app.post("/api/auth/register", async (req, res, next) => {
    try {
      const { name, email, password } = req.body || {};
      console.log(`[auth] Tentative d'inscription pour ${email || "email absent"}`);

      if (!name || !email || !password || password.length < 8) {
        console.warn("[auth] Inscription refusée : données invalides ou incomplètes");
        return res.status(400).json({
          message: "Nom, email et mot de passe de 8 caractères requis",
        });
      }

      // Vérifie si l'email est déjà utilisé avant de créer un nouvel utilisateur.
      if (await User.exists({ email: String(email).toLowerCase() })) {
        console.warn(`[auth] Email déjà utilisé : ${email}`);
        return res.status(409).json({ message: "Email déjà utilisé" });
      }

      // Crée l'utilisateur et le stocke dans MongoDB. Le mot de passe est haché
      // par le hook pre('validate') défini dans le schéma Mongoose.
      const user = await User.create({ name, email, password });
      console.log(`[auth] Utilisateur créé : ${user.id}`);
      res.status(201).json({ token: token(user), user: user.toPublic() });
    } catch (error) {
      console.error("[auth] Erreur pendant l'inscription", error);
      next(error);
    }
  });

  /** Vérifie les identifiants et ouvre une session JWT. Les identifiants sont envoyés dans le corps de la 
   * requête par un HTTP POST. */
  app.post("/api/auth/login", async (req, res, next) => {
    try {
        // req.body est déjà un objet JavaScript grâce au middleware express.json() placé plus haut.
        // il contient les champs email et password envoyés par le frontend Angular.
      const email = String(req.body?.email || "").toLowerCase();
      console.log(`[auth] Tentative de connexion pour ${email || "email absent"}`);

      // Sélectionne le mot de passe haché pour vérifier les identifiants.
      // User est un modèle Mongoose qui correspond au schéma défini dans models/User.js.
      // on envoie les requête à MongoDB via cet objet. Le mot de passe haché est stocké dans 
      // passwordHash, mais il n'est pas renvoyé par défaut dans les requêtes pour 
      // des raisons de sécurité.
      const user = await User.findOne({ email }).select("+passwordHash");

      if (!user || !(await user.verifyPassword(req.body?.password || ""))) {
        console.warn(`[auth] Identifiants incorrects pour ${email}`);
        return res.status(401).json({ message: "Identifiants incorrects" });
      }

      console.log(`[auth] Connexion réussie : ${user.id}`);
      res.json({ token: token(user), user: user.toPublic() });
    } catch (error) {
      console.error("[auth] Erreur pendant la connexion", error);
      next(error);
    }
  });

  /** Retourne le profil public de l'utilisateur identifié par le JWT. 
   * Les paramètres sont :
   * @param auth - Le middleware qui vérifie le JWT et ajoute req.auth. 
   * @param {Object} req - La requête HTTP.
   * @param {Object} res - La réponse HTTP.
   * @param {Function} next - La fonction de middleware suivante.
  */
  app.get("/api/users/me", auth, async (req, res, next) => {
    try {
        // req.auth.sub contient l'identifiant MongoDB de l'utilisateur 
        // extrait du JWT par le middleware auth. ici req.auth est un objet ajouté par le middleware 
        // auth à la requête, et sub est la propriété qui contient l'identifiant de l'utilisateur.
      const user = await User.findById(req.auth.sub);
      if (!user) {
        console.warn(`[user] Profil introuvable : ${req.auth.sub}`);
        return res.status(404).json({ message: "Utilisateur inconnu" });
      }

      console.log(`[user] Profil envoyé : ${user.id}`);
      res.json(user.toPublic());
    } catch (error) {
      console.error("[user] Erreur de lecture du profil", error);
      next(error);
    }
  });

  /** Modifie uniquement le nom de l'utilisateur connecté. */
  app.put("/api/users/me", auth, async (req, res, next) => {
    try {
      const user = await User.findByIdAndUpdate(
        req.auth.sub,
        { $set: { name: req.body?.name } },
        { new: true, runValidators: true },
      );

      if (!user) {
        console.warn(`[user] Mise à jour impossible : ${req.auth.sub}`);
        return res.status(404).json({ message: "Utilisateur inconnu" });
      }

      console.log(`[user] Nom mis à jour : ${user.id}`);
      res.json(user.toPublic());
    } catch (error) {
      console.error("[user] Erreur de mise à jour du profil", error);
      next(error);
    }
  });

  /** Retourne une page des pistes appartenant exclusivement à l'utilisateur. */
  app.get("/api/tracks", auth, async (req, res, next) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 5));
      const filter = { ownerId: req.auth.sub };

      console.log(`[tracks] Lecture page=${page}, limit=${limit}, user=${req.auth.sub}`);

      // La lecture des pistes et le comptage total sont parallélisés pour réduire la latence.
      // on utilise Promise.all pour exécuter les deux opérations en parallèle. 
      // Track.find() récupère les pistes de l'utilisateur avec pagination, 
      // tandis que Track.countDocuments() compte le nombre total de pistes pour cet utilisateur.
      // Promise.all attend que les deux opérations soient terminées avant de continuer et les résultats
        // sont stockés dans les variables items et total.
      const [items, total] = await Promise.all([
        Track.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .select("-storedName")
          .lean(),
        Track.countDocuments(filter),
      ]);

      // Track.publicFrom transforme chaque piste pour inclure uniquement les champs
      // nécessaires à l'API : _id devient id et les noms de stockage disparaissent.
      const publicItems = items.map((track) => Track.publicFrom(track));

      console.log(`[tracks] ${publicItems.length} piste(s) envoyée(s) sur ${total}`);

      // envoi de la réponse JSON avec les pistes publiques, la page actuelle, la limite par page, 
      // le nombre total de pistes et le nombre total de pages.
      res.json({
        items: publicItems,
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      });
    } catch (error) {
      console.error("[tracks] Erreur de pagination", error);
      next(error);
    }
  });

  /**
   * Reçoit le champ multipart audio, une pochette optionnelle (champ cover) et
   * les champs texte title, artist, album et genre.
   * upload.fields place les fichiers dans req.files.audio et req.files.cover,
   * tandis que req.body contient les champs texte associés.
   * Le middleware auth vérifie le JWT avant d'accepter l'upload.
   * Avant l'écriture dans GridFS, music-metadata lit les tags du fichier :
   * une valeur saisie par l'utilisateur est prioritaire sur le tag.
   * La pochette envoyée est prioritaire sur celle intégrée au fichier.
   */
  app.post(
    "/api/tracks",
    auth,
    upload.fields([
      { name: "audio", maxCount: 1 },
      { name: "cover", maxCount: 1 },
    ]),
    async (req, res, next) => {
      const audio = req.files?.audio?.[0];
      const coverFile = req.files?.cover?.[0];
      // Identifiants GridFS écrits pendant cette requête, à nettoyer en cas d'échec.
      const written = [];

      try {
        // Les fichiers sont encore en mémoire : un refus n'écrit rien en base.
        if (!audio) {
          console.warn(`[tracks] Upload sans fichier par ${req.auth.sub}`);
          return res.status(400).json({ message: "Fichier audio requis" });
        }

        if (coverFile && coverFile.size > MAX_COVER_SIZE) {
          console.warn(`[tracks] Pochette trop lourde : ${coverFile.size} octets`);
          return res.status(400).json({ message: "La pochette ne doit pas dépasser 5 Mo" });
        }

        const metadata = await extractMetadata(audio.buffer, audio.mimetype);

        const fileId = await storage.save(audio.buffer, {
          filename: audio.originalname,
          contentType: audio.mimetype,
        });
        written.push(fileId);

        // La pochette envoyée est prioritaire sur celle intégrée au fichier.
        const cover = coverFile
          ? { data: coverFile.buffer, mimeType: coverFile.mimetype }
          : metadata.picture;
        let coverFileId;
        if (cover) {
          coverFileId = await storage.save(cover.data, {
            filename: "cover" + IMAGE_EXTENSIONS[cover.mimeType],
            contentType: cover.mimeType,
          });
          written.push(coverFileId);
        }

        const body = req.body || {};
        const track = await Track.create({
          ownerId: req.auth.sub,
          title: pickText(body.title, metadata.title, audio.originalname),
          artist: pickText(body.artist, metadata.artist),
          album: pickText(body.album, metadata.album),
          genre: pickText(body.genre, metadata.genre),
          year: metadata.year,
          duration: metadata.duration,
          bitrate: metadata.bitrate,
          sampleRate: metadata.sampleRate,
          originalName: audio.originalname,
          fileId,
          mimeType: audio.mimetype,
          size: audio.size,
          coverFileId,
          coverMimeType: cover?.mimeType,
        });

        console.log(`[tracks] Upload enregistré : ${track.id}`);
        res.status(201).json(track.toPublic());
      } catch (error) {
        console.error("[tracks] Erreur pendant l'enregistrement de la piste", error);

        // Si la création de la piste échoue après l'écriture dans GridFS, on
        // tente de nettoyer les fichiers orphelins. L'erreur de nettoyage est
        // elle aussi loguée.
        await Promise.all(written.map(removeQuietly));
        next(error);
      }
    },
  );

  /** Retourne les métadonnées d'une seule piste de l'utilisateur. */
  app.get("/api/tracks/:id", auth, validId, async (req, res, next) => {
    try {
      const track = await Track.findOne({
        _id: req.params.id,
        ownerId: req.auth.sub,
      });

      if (!track) {
        console.warn(`[tracks] Piste introuvable ou interdite : ${req.params.id}`);
        return res.status(404).json({ message: "Piste inconnue" });
      }

      console.log(`[tracks] Piste envoyée : ${track.id}`);
      res.json(track.toPublic());
    } catch (error) {
      console.error("[tracks] Erreur de lecture d'une piste", error);
      next(error);
    }
  });

  /** Envoie la pochette d'une piste après vérification de sa propriété. */
  app.get("/api/tracks/:id/cover", auth, validId, async (req, res, next) => {
    try {
      const track = await Track.findOne({
        _id: req.params.id,
        ownerId: req.auth.sub,
      }).select("+coverFileId");

      if (!track) {
        console.warn(`[tracks] Pochette introuvable ou interdite : ${req.params.id}`);
        return res.status(404).json({ message: "Piste inconnue" });
      }
      if (!track.coverFileId || !(await storage.info(track.coverFileId))) {
        console.log(`[tracks] Piste sans pochette : ${track.id}`);
        return res.status(404).json({ message: "Pochette absente" });
      }

      res.type(track.coverMimeType);
      res.set("Cache-Control", "private, max-age=3600");
      sendStream(storage.stream(track.coverFileId), res, next, `pochette ${track.id}`);
    } catch (error) {
      console.error("[tracks] Erreur de préparation de la pochette", error);
      next(error);
    }
  });

  /** Envoie le contenu binaire d'une piste après vérification de sa propriété. */
  app.get("/api/tracks/:id/audio", auth, validId, async (req, res, next) => {
    try {
      const track = await Track.findOne({
        _id: req.params.id,
        ownerId: req.auth.sub,
      }).select("+fileId");

      if (!track) {
        console.warn(`[tracks] Audio introuvable ou interdit : ${req.params.id}`);
        return res.status(404).json({ message: "Piste inconnue" });
      }

      const file = track.fileId && (await storage.info(track.fileId));
      if (!file) {
        // Cas d'une piste créée avant GridFS dont le fichier n'a pas été migré.
        console.warn(`[tracks] Fichier audio absent de la base : ${track.id}`);
        return res.status(404).json({ message: "Fichier audio indisponible" });
      }

      res.type(track.mimeType);
      res.set("Accept-Ranges", "bytes");

      // req.range lit l'en-tête Range (lecture partielle, ex. pour avancer
      // dans le morceau) : -1 = plage impossible, -2 = en-tête mal formé.
      let start = 0;
      let end = file.length - 1;
      const ranges = req.range(file.length);
      if (ranges === -1) {
        res.set("Content-Range", `bytes */${file.length}`);
        return res.status(416).end();
      }
      if (Array.isArray(ranges) && ranges.type === "bytes") {
        ({ start, end } = ranges[0]);
        res.status(206).set("Content-Range", `bytes ${start}-${end}/${file.length}`);
      }
      res.set("Content-Length", String(end - start + 1));

      // Dans GridFS, `end` est exclusif, d'où le + 1.
      sendStream(
        storage.stream(track.fileId, { start, end: end + 1 }),
        res,
        next,
        `audio ${track.id}`,
      );
    } catch (error) {
      console.error("[tracks] Erreur de préparation du flux audio", error);
      next(error);
    }
  });

  /** Supprime la métadonnée et le fichier physique correspondant. */
  app.delete("/api/tracks/:id", auth, validId, async (req, res, next) => {
    try {
      const track = await Track.findOneAndDelete({
        _id: req.params.id,
        ownerId: req.auth.sub,
      }).select("+fileId +coverFileId");

      if (!track) {
        console.warn(`[tracks] Suppression impossible : ${req.params.id}`);
        return res.status(404).json({ message: "Piste inconnue" });
      }

      // La pochette est secondaire : un échec est logué sans bloquer la suppression.
      if (track.coverFileId) {
        await removeQuietly(track.coverFileId);
      }

      if (!track.fileId) {
        // Piste créée avant GridFS : il n'y a aucun fichier à supprimer en base.
        console.warn(`[tracks] Piste sans fichier GridFS supprimée : ${track.id}`);
        return res.status(204).end();
      }

      try {
        await storage.remove(track.fileId);
      } catch (error) {
        // L'exception n'est volontairement pas ignorée : l'administrateur doit
        // voir ce fichier orphelin si sa suppression échoue.
        console.error(`[tracks] Fichier audio non supprimé : ${track.fileId}`, error);
        return res.status(500).json({
          message: "Métadonnée supprimée, mais fichier audio non supprimé",
        });
      }

      res.status(204).end();
    } catch (error) {
      console.error("[tracks] Erreur de suppression", error);
      next(error);
    }
  });

  /** Gestionnaire central des erreurs connues de l'application. */
  app.use((error, _req, res, next) => {
    console.error("[error] Erreur reçue par le gestionnaire central", error);

    if (
      error instanceof multer.MulterError ||
      error?.message === AUDIO_FORMAT_ERROR ||
      error?.message === COVER_FORMAT_ERROR
    ) {
      return res.status(400).json({ message: error.message });
    }
    if (error?.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }
    if (error?.name === "CastError") {
      return res.status(404).json({ message: "Ressource inconnue" });
    }

    next(error);
  });

  return app;
}
