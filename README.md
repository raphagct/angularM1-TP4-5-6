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

## Connexion et enrichissement des pistes

Le backend accepte les connexions existantes par mot de passe. Les nouvelles options nécessitent les variables de `backend/.env.example` : `SMTP_*` pour les liens de connexion et `GOOGLE_CLIENT_ID` pour Google Identity Services. Le domaine local `http://localhost:4200` doit être autorisé dans la configuration du client Google. Définir également `JWT_SECRET` avec une valeur longue et aléatoire ; sans cela, une clé temporaire est créée et les sessions expirent au redémarrage. Le fichier `.env` reste privé. Redémarrer le backend après avoir configuré ces valeurs.

Un lien email est valable 10 minutes et une seule fois, pour un compte déjà créé. Si un compte possède déjà un mot de passe, se connecter puis associer Google depuis le profil avant d’utiliser ce bouton pour la connexion. Les fichiers audio locaux peuvent fournir artiste, album, durée et pochette. Le graphique des fréquences apparaît pendant la lecture d’une piste locale.

Spotify et YouTube ne permettent pas de copier leurs fichiers audio via leurs API usuelles. Les accès Deezer et SoundCloud ne fournissent pas ici une route de téléchargement documentée et configurée pour un import fiable ; aucune recherche externe ne suggère donc à tort un import possible. Un fichier obtenu avec les droits nécessaires peut être importé avec le formulaire existant.
