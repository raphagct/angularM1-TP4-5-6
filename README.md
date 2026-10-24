# Guitar Practice Cloud — package étudiant

Ce dépôt contient uniquement les ressources nécessaires aux trois TP :
`backend/` et `frontend-starter/`, ainsi que les sujets et documents utiles.

## Prérequis

- Node.js 22 ou plus récent ;
- un compte MongoDB Atlas par binôme ;
- Git et un navigateur récent.
- Un IDE de qualité
- Recommandé : un abonnement à un 

Consulter [ATLAS_SETUP.md](ATLAS_SETUP.md) pour créer la base de données.

## Démarrer le backend

```bash
cd backend
cp .env.example .env
```

Renseigner dans `.env` l’URI MongoDB Atlas et le secret JWT. Ne jamais publier
ce fichier ni copier un secret dans le code Angular.

```bash
npm install
npm start
```

Le backend écoute normalement sur `http://localhost:3000`.

## Démarrer le frontend

Dans un autre terminal :

```bash
cd frontend-starter
npm install
npm start
```

Ouvrir `http://localhost:4200`. Le compte de démonstration est
`demo@example.com` / `Demo1234!`.

## Remix : extraction de la voix (Demucs)

La page d'une piste propose d'isoler sa voix avec [Demucs](https://github.com/adefossez/demucs)
puis de la poser sur une autre piste de la bibliothèque. Demucs tourne sur la
machine du backend (Python, 2 à 4 Go de RAM, 1 à 5 minutes par morceau sur CPU) :

```bash
pip install demucs numpy
python -m demucs --help   # vérifie l'installation
```

Le backend lance `python -m demucs` ; si Python a un autre nom (ex. `py` sous
Windows), ajouter `DEMUCS_PYTHON=py` dans `backend/.env`. Le modèle (≈ 80 Mo) est
téléchargé au premier lancement. Seule la voix est conservée, en MP3 192 kbps
(≈ 5 Mo pour 4 minutes), dans GridFS.

| Route | Rôle | Réponses |
|---|---|---|
| `POST /api/tracks/:id/vocals` | Lance la séparation en tâche de fond | `202` piste avec `vocalsStatus: "processing"` · `409` déjà en cours ou déjà extraite · `404` piste inconnue · `401` |
| `GET /api/tracks/:id/vocals` | Envoie la voix (`audio/mpeg`, `Range` accepté) | `200` / `206` · `416` · `404` piste inconnue ou voix non extraite · `401` |
| `DELETE /api/tracks/:id/vocals` | Supprime la voix, la piste est conservée | `204` · `409` séparation en cours · `404` · `401` |

Toutes ces routes exigent `Authorization: Bearer <token>` et ne concernent que
les pistes de l'utilisateur. Les pistes renvoyées par l'API ont un champ
`vocalsStatus` : `none`, `processing`, `ready` ou `failed`. Le frontend interroge
`GET /api/tracks/:id` toutes les 5 secondes tant que le statut vaut `processing`.
Une séparation interrompue par un redémarrage du backend passe à `failed`.
Supprimer une piste supprime aussi sa voix.

## Documents de travail

- [SUJET_ETUDIANT_TP1.md](SUJET_ETUDIANT_TP1.md), [SUJET_ETUDIANT_TP2.md](SUJET_ETUDIANT_TP2.md) et [SUJET_ETUDIANT_TP3.md](SUJET_ETUDIANT_TP3.md) : missions des trois séances ;
- [API_CONTRACT.md](API_CONTRACT.md) : endpoints, authentification et formats échangés ;
- [RAPPORT_IA_MODELE.md](RAPPORT_IA_MODELE.md) : modèle de compte rendu.
- [CONSEILS_POUR_UTIISER_ASSISTANT_AI.md](CONSEILS_POUR_UTIISER_ASSISTANT_AI.md) : utiliser correctement un assistant IA, quel que soit l’outil choisi.

Le backend contient également ses propres consignes pour les assistants :
[`backend/AGENTS.md`](backend/AGENTS.md), [`backend/CLAUDE.md`](backend/CLAUDE.md),
[`backend/GEMINI.md`](backend/GEMINI.md) et
[`backend/best-practices.md`](backend/best-practices.md). Elles couvrent
Node.js, Express, Mongoose, MongoDB, l’authentification, Multer, les uploads,
les logs et les tests.

Les fichiers audio présents dans `frontend-starter/fichiers-audio-de-test/` sont
des fixtures fournies pour les essais. Aucun fichier uploadé, dossier de
dépendances (`node_modules`), fichier `.env` ou identifiant local n’est inclus.
