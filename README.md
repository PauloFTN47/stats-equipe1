# Joueur CASTEL - Équipe 1 Casteljaloux

Appli installable (PWA) de saisie des statistiques de l'équipe 1.
Chaque joueur se connecte avec son nom et un code personnel, saisit ses tours et consulte les siens.
Les données sont écrites dans un Google Sheets par un script Apps Script (hébergé chez Google).

Ce dépôt ne contient aucun secret : les codes personnels sont stockés côté Apps Script.

## Fichiers

- `index.html`, `styles.css`, `app.js` : l'appli
- `config.js` : adresse de l'API Apps Script
- `manifest.webmanifest`, `sw.js`, `icons/` : installation sur l'écran d'accueil et mode hors ligne

## Staff

Un onglet réservé au staff (capitaine, vice-capitaine, coach, capitaines des jeux, président) : lien « Accès staff » sur l'écran de connexion.
Chaque membre a un code individuel distinct des codes joueurs. Les droits sont contrôlés par l'API à chaque requête, pas par l'interface :
synthèse d'équipe, fiche joueur, classement, calendrier pour tous ; notes mentales individuelles pour le capitaine seul.

## Mettre à jour l'appli

Après toute modification des fichiers de l'appli, changer le numéro de version `VERSION` dans `sw.js`
pour que les téléphones récupèrent la nouvelle version.

## Mode simulation

Ajouter `?simulation=1` à l'adresse : toute la saisie est vérifiée et calculée, rien n'est écrit dans le Sheets.
