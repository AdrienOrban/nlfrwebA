# NL ⇄ FR — site de cartes de vocabulaire

Site web de révision néerlandais-français, avec comptes, listes de mots
personnelles ou communes, et cartes à faire glisser façon Tinder.

- **Comptes** : chacun s'inscrit avec son e-mail et son mot de passe.
- **Listes** : autant que vous voulez. Une liste est soit **personnelle**
  (vous seul), soit **commune** (vous invitez d'autres personnes par
  e-mail).
- **Progression individuelle** : sur une liste commune, tout le monde voit
  les mêmes mots, mais chacun garde ses propres mots connus. Si votre
  copine marque `de hond` comme connu, ça ne change rien chez vous.
- **Cartes** : glisser à droite = connu, à gauche = à revoir plus tard,
  vers le haut = retirer le mot de la liste. Un mot déjà connu revient en
  révision tous les 5 mots.
- **CSV** : import et export par liste.

Il n'y a rien à compiler : ce sont trois fichiers statiques
(`index.html`, `style.css`, `app.js`) plus une base de données hébergée
gratuitement chez Supabase.

---

## Pourquoi une base de données ?

Dans la version APK, tout était stocké dans le téléphone. Dès qu'on veut
**plusieurs comptes** et une **liste commune à plusieurs personnes**, il
faut un endroit central où ranger les données. **Supabase** fournit ça
(authentification + base PostgreSQL) avec une offre gratuite largement
suffisante ici, et sans serveur à administrer.

Architecture : le site est un ensemble de fichiers statiques hébergés sur
GitHub Pages, qui parle directement à Supabase depuis le navigateur. Les
règles de sécurité vivent dans la base, pas dans le site.

---

## Étape 1 — Créer le projet Supabase

1. Allez sur <https://supabase.com>, créez un compte, puis
   **New project**.
2. Donnez-lui un nom, un mot de passe de base de données (notez-le), et
   choisissez la région **Europe (Frankfurt ou Ireland)**.
3. Attendez deux minutes que le projet se crée.

## Étape 2 — Installer les tables

1. Dans le menu de gauche : **SQL Editor** → **New query**.
2. Ouvrez le fichier `supabase/schema.sql` de ce dépôt, copiez **tout**
   son contenu, collez-le dans l'éditeur.
3. Cliquez **Run**. Vous devez voir « Success ».

Ce script crée les tables (profils, listes, membres, mots, progression),
les règles d'accès, et deux fonctions utilitaires pour inviter des gens.

## Étape 3 — Régler l'authentification

Dans **Authentication** → **Sign In / Providers** :

- Vérifiez que **Email** est activé.
- Pour un usage entre proches, le plus simple est de **désactiver la
  confirmation par e-mail** (« Confirm email ») : les comptes sont
  utilisables immédiatement. Si vous la laissez activée, chacun devra
  cliquer le lien reçu par e-mail avant de pouvoir se connecter.

Dans **Authentication** → **URL Configuration**, mettez l'adresse
publique de votre site (celle de l'étape 5) dans **Site URL**.

## Étape 4 — Brancher le site sur la base

1. Dans Supabase : **Project Settings** → **API**. Notez :
   - **Project URL** (`https://xxxx.supabase.co`)
   - la clé **anon public**
2. Ouvrez `config.js` dans ce dépôt et remplacez les deux valeurs.

```js
export const SUPABASE_URL = "https://xxxx.supabase.co";
export const SUPABASE_KEY = "eyJhbGciOi...";
```

La clé `anon` est **faite pour être publique** : elle ne donne accès à
rien par elle-même. Ce sont les règles d'accès (RLS) du script SQL qui
décident qui voit quoi. Ne mettez **jamais** la clé `service_role` dans
ce fichier.

## Étape 5 — Mettre le site en ligne (GitHub Pages)

1. Créez un dépôt sur GitHub et poussez ce dossier :

   ```bash
   git init
   git add .
   git commit -m "Site de cartes NL-FR"
   git branch -M main
   git remote add origin https://github.com/<votre-compte>/<votre-depot>.git
   git push -u origin main
   ```

2. Dans le dépôt GitHub : **Settings** → **Pages** → section *Build and
   deployment* → **Source : GitHub Actions**.
3. Le workflow `.github/workflows/deploy.yml` se déclenche à chaque
   `push` sur `main`. Suivez-le dans l'onglet **Actions**.
4. Une fois vert, votre site est à
   `https://<votre-compte>.github.io/<votre-depot>/`.
5. Retournez dans Supabase → **Authentication** → **URL Configuration**
   et collez cette adresse dans **Site URL**.

### Alternative : Netlify ou Vercel

Si vous préférez, glissez simplement le dossier sur
<https://app.netlify.com/drop> : le site est en ligne en quelques
secondes, avec une adresse personnalisable. Aucune configuration
supplémentaire n'est nécessaire, c'est le même site statique.

## Étape 6 — Premiers pas à deux

1. Ouvrez le site, onglet **Créer un compte**, inscrivez-vous.
2. Une liste « Ma liste » est créée automatiquement. Allez dans l'onglet
   **Mots** et importez `mots-exemple.csv` pour démarrer.
3. Demandez à votre copine de **créer son compte** sur la même adresse.
4. De votre côté : onglet **Listes** → *Nouvelle liste* → cochez
   **Commune** → créez-la.
5. La fenêtre de gestion s'ouvre : saisissez **l'e-mail de son compte**
   → **Donner accès**.
6. Elle voit la liste apparaître chez elle à sa prochaine connexion.
   Vous partagez les mots ; chacun garde sa progression.

> L'invitation ne fonctionne que si la personne a **déjà créé son
> compte** — c'est son e-mail de compte qui sert d'identifiant.

---

## Installer le site comme une application sur le téléphone

Le site est une *Progressive Web App* : pas besoin d'APK.

- **Android / Chrome** : menu ⋮ → *Ajouter à l'écran d'accueil*.
- **iPhone / Safari** : bouton Partager → *Sur l'écran d'accueil*.

L'icône se comporte comme une vraie appli (plein écran, sans barre
d'adresse).

---

## Format CSV

```
nl,fr,known
de appel,la pomme,0
goedemorgen,bonjour (le matin),1
```

`known` vaut `1` si **vous** connaissez déjà le mot. Le point-virgule est
accepté comme séparateur (pratique avec Excel en français). À l'import,
un mot déjà présent dans la liste n'est pas dupliqué. L'export reflète
votre progression personnelle, pas celle des autres membres.

---

## Structure du dépôt

```
index.html              page unique du site
style.css               styles
app.js                  logique (comptes, listes, cartes, CSV)
config.js               ← vos identifiants Supabase
manifest.webmanifest    pour l'installation sur téléphone
icon.svg                icône
mots-exemple.csv        liste de départ à importer
supabase/schema.sql     à exécuter une fois dans Supabase
.github/workflows/      déploiement automatique sur GitHub Pages
```

## Dépannage

| Symptôme | Cause probable |
| --- | --- |
| « Configuration incomplète » à l'ouverture | `config.js` contient encore les valeurs d'exemple |
| Inscription qui ne connecte pas | La confirmation par e-mail est activée : cliquez le lien reçu |
| « Aucun compte avec cet e-mail » | La personne invitée ne s'est pas encore inscrite |
| Listes vides après connexion | Le script `schema.sql` n'a pas été exécuté entièrement |
| Page blanche | Ouvrez la console du navigateur (F12) : une erreur de clé Supabase s'y affiche |

## Coûts

L'offre gratuite de Supabase couvre très largement quelques utilisateurs
et quelques milliers de mots. GitHub Pages est gratuit pour les dépôts
publics. Attention : un projet Supabase gratuit est mis en pause après
une semaine sans aucune activité — il suffit de le relancer depuis le
tableau de bord.
