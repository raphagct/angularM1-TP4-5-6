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
| POST | `/tracks` | multipart : `audio`, `title` | `201 Track` |
| GET | `/tracks/:id/audio` | JWT | flux audio |
| DELETE | `/tracks/:id` | JWT | `204` (bonus) |

`Page<Track>` contient `items`, `page`, `limit`, `total` et `pages`. Formats acceptés : MP3, WAV, OGG et M4A, 25 Mo maximum.

Erreurs courantes : `400` validation, `401` authentification, `404` ressource, `409` email déjà utilisé.

## Extensions : authentification et métadonnées audio

Les routes historiques ci-dessus restent disponibles. Les routes publiques ci-dessous ne demandent pas de JWT ; `POST /auth/google/link` demande un JWT. Les réponses de connexion ont toujours la forme `{token,user}` et le JWT protège les mêmes routes privées.

| Méthode | Route | Auth | Paramètres / corps | Réponse | Erreurs |
|---|---|---|---|---|---|
| GET | `/auth/google/config` | Non | Aucun | `200 {clientId: string\|null}` | — |
| POST | `/auth/google` | Non | `{credential}` : jeton d’identité Google | `200 {token,user}` | `400` corps invalide, `401` jeton refusé, `409` email déjà associé à un compte local, `503` Google non configuré |
| POST | `/auth/google/link` | JWT | `{credential}` : jeton Google avec le même email que le compte connecté | `200 {user}` | `401` JWT ou jeton Google invalide, `404` compte absent, `409` email différent ou Google déjà associé, `503` Google non configuré |
| POST | `/auth/magic/request` | Non | `{email}` | `200 {message}` (même réponse si email inconnu) | `400` email invalide, `503` SMTP absent ou envoi impossible |
| POST | `/auth/magic/verify` | Non | `{token}` : jeton reçu par email | `200 {token,user}` | `400` jeton mal formé, `401` lien expiré, utilisé ou compte absent |
| GET | `/tracks/:id/cover` | JWT | `id` : piste du propriétaire | `200` image JPEG ou PNG | `401` JWT absent/invalide, `404` piste ou pochette absente |

Le lien email expire après dix minutes et ne fonctionne qu’une fois. Il est envoyé uniquement aux comptes existants. Les nouveaux comptes Google sont créés à partir d’une identité Google dont l’email a été vérifié ; un compte local existant doit d’abord se connecter puis associer explicitement Google depuis le profil.

`POST /tracks` conserve `audio` et `title` (multipart). Le serveur peut choisir le titre embarqué dans le fichier si `title` est vide. La réponse `Track` et les éléments de `GET /tracks` ajoutent `artist`, `album`, `duration` (secondes, optionnelle) et `hasCover` (booléen). Les anciens champs et statuts restent inchangés. Une pochette embarquée JPEG/PNG de 2 Mo maximum peut être enregistrée ; l’absence de métadonnées n’empêche pas l’upload. La suppression d’une piste supprime également sa pochette éventuelle.

L’import automatisé depuis Spotify, Deezer, YouTube et SoundCloud n’a pas de route API : seules les sources dont l’API autorise et fournit l’audio complet peuvent être proposées comme importables. La recherche externe n’est donc pas exposée avec les accès actuels.
