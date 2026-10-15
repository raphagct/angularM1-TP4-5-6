# Contrat HTTP - TP1

Base : `/api`. Sauf inscription et connexion, envoyer `Authorization: Bearer <token>`.

Le contrat HTTP ne dépend pas du choix de persistance : le backend fourni utilise Mongoose et MongoDB. MongoDB conserve les utilisateurs et métadonnées ; les octets des fichiers audio restent sur le disque du serveur.

| Méthode | Route | Requête | Réponse principale |
|---|---|---|---|
| GET | `/health` | - | `{ "status": "ok" }` |
| POST | `/auth/register` | `{name,email,password}` | `201 {token,user}` |
| POST | `/auth/login` | `{email,password}` | `200 {token,user}` |
| GET | `/users/me` | JWT | `200 User` |
| PUT | `/users/me` | `{name}` + JWT | `200 User` |
| GET | `/tracks?page=1&limit=5` | JWT | `Page<Track>` |
| POST | `/tracks` | multipart : `audio`, `cover?`, `title?`, `artist?`, `album?`, `genre?` | `201 Track` |
| GET | `/tracks/:id` | JWT | `200 Track` |
| GET | `/tracks/:id/audio` | JWT | flux audio (supporte `Range`) |
| GET | `/tracks/:id/cover` | JWT | image de la pochette |
| DELETE | `/tracks/:id` | JWT | `204` (bonus) |

`Page<Track>` contient `items`, `page`, `limit`, `total` et `pages`. Formats acceptés : MP3, WAV, OGG et M4A, 25 Mo maximum.

`Track` contient `id`, `ownerId`, `title`, `originalName`, `mimeType`, `size`, `createdAt`, `hasCover` et, lorsqu'ils sont connus, `artist`, `album`, `genre`, `year`, `duration` (secondes), `bitrate` (bit/s) et `sampleRate` (Hz). Les noms de stockage sur disque ne sont jamais renvoyés.

### Upload `POST /tracks`

- Authentification : JWT obligatoire.
- Corps `multipart/form-data` :
  - `audio` (obligatoire) : MP3, WAV, OGG ou M4A, 25 Mo maximum ;
  - `cover` (optionnel) : JPEG, PNG ou WebP, 5 Mo maximum ;
  - `title`, `artist`, `album`, `genre` (optionnels, texte).
- Après l'écriture du fichier, le serveur lit ses tags (ID3, Vorbis, MP4) : titre, artiste, album, genre, année, durée, débit, fréquence et pochette intégrée.
- Priorités : une valeur saisie l'emporte sur le tag ; sans titre ni tag, le nom du fichier est utilisé. Une pochette envoyée l'emporte sur la pochette intégrée.
- Un fichier sans tags reste accepté.
- Réponses : `201 Track` ; `400` sans audio, format audio ou image refusé, pochette trop lourde ou champ invalide ; `401` sans JWT. En cas d'erreur après l'écriture, les fichiers sont supprimés.

### `GET /tracks/:id` et `GET /tracks/:id/cover`

- Authentification : JWT obligatoire ; seule une piste de l'utilisateur est accessible.
- `GET /tracks/:id` : `200 Track`.
- `GET /tracks/:id/cover` : `200` avec l'image et son `Content-Type` (`Cache-Control: private`).
- Erreurs : `401` sans JWT ; `404 {message:"Piste inconnue"}` si l'identifiant est invalide, inexistant ou appartient à un autre utilisateur ; `404 {message:"Pochette absente"}` si la piste n'a pas de pochette.

`DELETE /tracks/:id` supprime aussi la pochette.

Erreurs courantes : `400` validation, `401` authentification, `404` ressource, `409` email déjà utilisé.
