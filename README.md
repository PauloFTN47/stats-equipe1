# Joueur CASTEL - Équipe 1 Casteljaloux

Appli installable (PWA) de saisie des statistiques de l'équipe 1.
Chaque joueur se connecte avec son nom et un code personnel, saisit ses tours et consulte les siens.
Les données sont écrites dans un Google Sheets par un script Apps Script (hébergé chez Google).

Ce dépôt ne contient aucun secret : les codes personnels sont stockés côté Apps Script.

## Fichiers

- `index.html`, `styles.css`, `app.js` : l'appli
- `config.js` : adresse de l'API Apps Script
- `manifest.webmanifest`, `sw.js`, `icons/` : installation sur l'écran d'accueil et mode hors ligne

## Mettre à jour l'appli

Après toute modification des fichiers de l'appli, changer le numéro de version `VERSION` dans `sw.js`
pour que les téléphones récupèrent la nouvelle version.

## Mode simulation

Ajouter `?simulation=1` à l'adresse : toute la saisie est vérifiée et calculée, rien n'est écrit dans le Sheets.
