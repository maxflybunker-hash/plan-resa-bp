# ResaBP → Plan de Salle — V102

La V102 lit directement les lignes déjà présentes dans `public.reservations` de Supabase. Si ResaBP/Base44 remplit déjà cette table, aucun deuxième webhook vers `resabp_reservations` n’est nécessaire pour afficher les réservations.

Le Plan demande les lignes de la date sélectionnée à `GET https://plan-resa-bp.pages.dev/api/resabp?date=YYYY-MM-DD`. La fonction serveur lit `public.reservations` avec ses identifiants serveur et renvoie seulement les champs nécessaires au Plan.

Le `POST /api/resabp` historique reste disponible pour compatibilité mais n’est pas utilisé par le GET et n’est pas nécessaire si `public.reservations` est déjà alimentée. Ne placez aucune clé `service_role` ou `sb_secret_` dans le navigateur ou dans un code client.
