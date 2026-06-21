# Pression

Application web protegee pour suivre des donnees de pression arterielle.

Le premier compte cree par l'application est un compte `admin`. Il peut creer
des utilisateurs, changer leur role, les activer/desactiver, supprimer un compte
et remettre un mot de passe.

## Demarrer en local

```bash
node server.js
```

Par defaut en developpement:

- Courriel: `admin@pression.local`
- Mot de passe: `ChangeMoi123!`

## Mise en ligne

Configure ces variables d'environnement sur l'hebergeur:

- `NODE_ENV=production`
- `APP_SECRET`: une longue valeur aleatoire
- `APP_ADMIN_EMAIL`: ton courriel de connexion
- `APP_ADMIN_PASSWORD`: un mot de passe fort
- `DATA_DIR`: dossier persistant pour `store.json`
- `PORT`: fourni automatiquement par la plupart des hebergeurs

L'application refuse de demarrer en production si `APP_SECRET`, `APP_ADMIN_EMAIL`
ou `APP_ADMIN_PASSWORD` manquent.

## Donnees

Les donnees sont stockees dans `data/store.json` en local. En production,
configure `DATA_DIR` vers un disque persistant. Le fichier `render.yaml` le
prepare avec un disque monte dans `/var/data`.
