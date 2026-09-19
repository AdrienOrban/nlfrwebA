# NL ⇄ FR — site de cartes de vocabulaire

Site web de révision néerlandais-français, avec accès par simple nom
d'utilisateur, listes de mots personnelles ou communes à un groupe, et
cartes à faire glisser façon Tinder.

- **Accès simple** : pas d'e-mail, pas de mot de passe à retenir. Vous
  (l'administrateur) créez un nom d'utilisateur pour chaque personne
  depuis l'appli ; elle n'a plus qu'à le taper pour entrer.
- **Listes** : autant que vous voulez. Une liste est soit **personnelle**
  (vous seul), soit **commune à un groupe** (vous donnez accès à
  d'autres noms d'utilisateur).
- **Progression individuelle** : sur une liste commune, tout le groupe
  voit les mêmes mots, mais chacun garde ses propres mots connus.
- **Cartes** : glisser à droite = connu, à gauche = à revoir plus tard,
  vers le haut = retirer le mot de la liste. Un mot déjà connu revient en
  révision tous les 5 mots.
- **CSV** : import et export par liste.

Il n'y a rien à compiler : ce sont des fichiers statiques (`index.html`,
`style.css`, `app.js`) plus une base de données hébergée gratuitement
chez Supabase.

---

## Comment marche l'accès par nom d'utilisateur

Il n'y a pas de vraie inscription : **vous seul créez les accès**, depuis
l'onglet **Admin** du site (réservé à l'administrateur — voir plus bas).
Vous tapez un nom, l'appli s'occupe du reste ; la personne n'a plus qu'à
taper ce même nom pour entrer, sur n'importe quel appareil.

**Ce que ça veut dire concrètement** : le nom d'utilisateur *est* la clé
d'accès. N'importe qui connaissant un nom valide peut se connecter avec.
C'est un choix assumé pour rester simple à utiliser entre proches — ce
n'est pas fait pour protéger des données sensibles. Choisissez des noms
qui ne sont pas évidents à deviner (pas juste « papa » ou « a ») si ça
vous rassure.

La toute première personne qui entre un nom d'utilisateur sur une base
neuve devient automatiquement **administratrice** (accès à l'onglet
Admin, qui permet de créer les accès suivants). Faites-le vous-même en
premier.

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
les règles d'accès, et les fonctions utilisées par l'onglet Admin.

## Étape 3 — Régler l'authentification (obligatoire, pas juste pratique)

Dans **Authentication** → **Sign In / Providers** → **Email** :

- Désactivez **« Confirm email »**.

Ce n'est pas facultatif ici : les noms d'utilisateur sont transformés en
fausses adresses (`camille@nlfr-app.local`) qui ne peuvent recevoir
aucun e-mail. Si la confirmation reste activée, **aucun accès, pas même
le vôtre, ne pourra jamais être utilisé.**

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

## Étape 5 — Mettre le site en ligne

**Méthode recommandée : Netlify**, la plus simple et la plus fiable —
elle évite complètement les soucis rencontrés avec GitHub Actions (fichier
`.github` invisible, permissions à activer, etc.).

1. Poussez ce dossier sur un dépôt GitHub (avec l'interface web, comme vu
   ensemble : *Add file* → *Upload files*, ou en ligne de commande).
2. Allez sur <https://app.netlify.com>, créez un compte (vous pouvez vous
   inscrire directement avec votre compte GitHub).
3. **Add new site** → **Import an existing project** → **Deploy with
   GitHub** → choisissez votre dépôt.
4. Netlify détecte un site statique : ne changez rien aux réglages de
   build, cliquez **Deploy**.
5. Après une minute, votre site est en ligne à une adresse du type
   `https://un-nom-au-hasard.netlify.app`. Vous pouvez la personnaliser
   dans **Site settings → Change site name**.
6. **Avantage important** : à partir de maintenant, chaque modification
   que vous poussez sur GitHub (même via *Commit changes* dans le
   navigateur) redéploie automatiquement le site, sans rien configurer
   de plus.
7. Retournez dans Supabase → **Authentication** → **URL Configuration**
   et collez cette adresse dans **Site URL**.

### Alternative encore plus rapide, sans compte GitHub

Glissez simplement le dossier sur <https://app.netlify.com/drop> : le
site est en ligne en quelques secondes. Inconvénient : pour le mettre à
jour ensuite, il faut re-glisser le dossier à chaque changement (pas de
mise à jour automatique).

### Vous avez déjà GitHub Pages qui fonctionne ?

Si vous avez suivi la configuration précédente avec `.github/workflows/
deploy.yml` et qu'elle fonctionne déjà chez vous, vous pouvez tout à
fait la garder : les deux méthodes hébergent exactement le même site.
Ce fichier reste dans le dépôt et ne gêne en rien Netlify.

## Étape 6 — Premiers pas

1. Ouvrez le site. Tapez **votre propre nom d'utilisateur** (ex.
   `adrien`) et cliquez **Accéder** : comme la base est neuve, ce nom
   devient automatiquement administrateur.
2. Une liste « Ma liste » est créée automatiquement. Onglet **Mots** →
   importez `mots-exemple.csv` pour démarrer.
3. Onglet **Admin** → tapez un nom pour votre copine (ex. `marie`) →
   **Créer cet accès**. Communiquez-lui simplement ce mot — rien d'autre
   à faire de son côté, elle ouvre le site et le tape.
4. Onglet **Listes** → *Nouvelle liste* → cochez **Commune** → créez-la.
5. La fenêtre de gestion s'ouvre : tapez **son nom d'utilisateur** (pas
   un e-mail) → **Donner accès**.
6. Elle voit la liste apparaître dès sa prochaine connexion. Vous
   partagez les mots ; chacun garde sa progression.

> Donner accès à une liste ne fonctionne que pour un nom d'utilisateur
> **déjà créé** dans l'onglet Admin.

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
app.js                  logique (accès, listes, cartes, CSV, admin)
config.js               ← vos identifiants Supabase
manifest.webmanifest    pour l'installation sur téléphone
icon.svg                icône
mots-exemple.csv        liste de départ à importer
supabase/schema.sql     à exécuter une fois dans Supabase
.github/workflows/      déploiement automatique optionnel sur GitHub Pages
```

## Dépannage

| Symptôme | Cause probable |
| --- | --- |
| « Configuration incomplète » à l'ouverture | `config.js` contient encore les valeurs d'exemple |
| Un nom d'utilisateur qu'on vient de créer ne se connecte pas | La confirmation par e-mail (étape 3) n'a pas été désactivée |
| « n'a pas encore d'accès » en essayant de partager une liste | Le nom tapé n'a pas été créé dans l'onglet Admin |
| Listes vides après connexion | Le script `schema.sql` n'a pas été exécuté entièrement |
| Page blanche | Ouvrez la console du navigateur (F12) : une erreur de clé Supabase s'y affiche |
| L'onglet Admin n'apparaît pas | Seul le tout premier compte créé sur la base l'a automatiquement ; les autres ne l'ont pas |

## Coûts

L'offre gratuite de Supabase couvre très largement un petit groupe et
quelques milliers de mots. Netlify est gratuit pour ce type de site.
Attention : un projet Supabase gratuit est mis en pause après une
semaine sans aucune activité — il suffit de le relancer depuis le
tableau de bord.
