/* Prompt de recherche à coller dans Cowork (ou tout assistant avec accès web).
   Source unique : le bouton « Copier le prompt » de l'admin lit cette constante.
   `zone` est injectée depuis le formulaire d'import. */

export function promptProspection(zone = "[ZONE À DÉMARCHER]") {
  return `Tu prépares une tournée de prospection terrain pour Cascanics, qui vend des
machines de nettoyage de casques en libre-service (moto, vélo, ski, chantier).

ZONE À COUVRIR : ${zone}

CIBLES — des lieux à fort passage de porteurs de casques, qui peuvent installer une
machine en libre-service et l'exploiter :
- Concessions moto et scooter
- Accessoiristes / équipementiers moto (Dafy, Maxxess, Cardy, indépendants…)
- Stations-service et aires d'autoroute
- Loueurs de deux-roues et flottes de livraison
- Salles de sport, stations de ski, centres de contrôle technique

MÉTHODE
1. Cherche les établissements réellement existants dans la zone (Google Maps,
   Pages Jaunes, sites officiels des enseignes, annuaires pro).
2. Pour chacun, relève les coordonnées publiques : adresse, téléphone, e-mail,
   nom du gérant si affiché.
3. Vise 20 à 40 établissements, en priorisant ceux à fort trafic (axes passants,
   zones commerciales, proximité d'une sortie d'autoroute, grandes enseignes).

RÈGLES STRICTES
- N'invente RIEN. Si une information n'est pas trouvée, laisse la chaîne vide ("").
  Un champ vide est acceptable, une donnée fausse ne l'est pas.
- Pas de doublon : un établissement = une entrée.
- "type" doit valoir EXACTEMENT l'une de ces valeurs :
  "Concession moto", "Accessoiriste moto", "Station-service", "Aire d'autoroute",
  "Loueur / flotte", "Salle de sport", "Station de ski",
  "Centre de contrôle technique", "Autre".
- "notes" : une phrase utile au commercial pour sa visite (trafic observé, enseigne,
  horaires, particularité du site). Pas de blabla commercial.

RÉPONSE ATTENDUE
Un seul bloc de code JSON, sans commentaire ni texte autour, exactement à ce format :

{
  "zone": "${zone}",
  "prospects": [
    {
      "entreprise": "Moto Expert Bordeaux Lac",
      "type": "Concession moto",
      "ville": "Bordeaux",
      "adresse": "12 avenue des Pins, 33300",
      "contact": "M. Dupont",
      "tel": "05 56 00 00 00",
      "email": "contact@motoexpert-bordeaux.fr",
      "notes": "Concession 3 marques en zone commerciale, gros passage le samedi."
    }
  ]
}`;
}
