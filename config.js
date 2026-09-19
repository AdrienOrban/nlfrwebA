// Remplacez ces deux valeurs par celles de votre projet Supabase.
// Elles se trouvent dans : Supabase > Project Settings > API
//   - SUPABASE_URL  = "https://htebgfopfswzrunlwgbq.supabase.co"
//   - SUPABASE_KEY  = "anon public" (clé publique, sans danger sur un site)
//
// La sécurité ne repose pas sur le secret de cette clé mais sur les
// règles d'accès (RLS) définies dans supabase/schema.sql.

export const SUPABASE_URL = "https://VOTRE-PROJET.supabase.co";
export const SUPABASE_KEY = "sb_publishable_VJScT3XkALfickOce3c4vg_ZBGX8Dhh";

// Sert uniquement à fabriquer un identifiant technique à partir du nom
// d'utilisateur (voir usernameToEmail/usernameToPassword dans app.js).
// Ce n'est pas un secret à protéger : la sécurité de cette appli repose
// sur le fait que seul l'administrateur crée les noms d'utilisateur, pas
// sur cette valeur. Vous pouvez la changer si vous voulez, ce n'est pas
// obligatoire.
export const APP_SALT = "nlfr-maison-2026";

