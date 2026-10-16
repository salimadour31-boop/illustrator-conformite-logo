# Conformité du logo — script Adobe Illustrator

**ConformiteLogo.jsx** v1.0.0 — retrouve **toutes les copies d'un logo** dans un document (copies collées, agrandies, tournées, instances de symbole, liens vers le même fichier) et vérifie chacune selon la charte graphique : **taille minimale, zone de protection libre, déformation, inclinaison, miroir, rotation, couleurs autorisées, transparence, logo rogné**.
*Finds every copy of a logo in a document and checks each one against the brand rules: minimum size, free clear space, distortion, skew, mirroring, rotation, allowed colour versions, transparency, cropping (FR/EN dialog).*

## Ce que fait le script

Sur une déclinaison (papeterie, kakémonos, posts, packaging, signalétique…), le logo est posé des dizaines de fois, souvent par plusieurs personnes. Le script fait le contrôle que le graphiste fait d'habitude à l'œil, logo par logo :

1. **Il retrouve les copies** du logo de référence sélectionné, à n'importe quelle taille, position ou rotation : même structure de tracés (groupes, tracés transparents, nombre de points), instances du même symbole (et copies dont le lien au symbole a été rompu), ou images liées au même fichier. Les textes vivants d'un logo sont vectorisés en coulisse sur une copie temporaire, puis effacés.
2. **Il calcule la transformation réelle** de chaque copie par rapport à la référence (ajustement affine aux moindres carrés sur les points d'ancrage) et en déduit l'échelle, la rotation, l'inclinaison, la symétrie et l'écart de proportions — même pour un logo tourné, ce que la boîte englobante ne permet pas.
3. **Il vérifie la charte** :
   - **taille minimale** (largeur, hauteur ou plus petit côté, en mm ou en px/pt), mesurée sur le logo lui-même, pas sur sa boîte tournée ;
   - **zone de protection** : X = facteur × hauteur, largeur ou plus petit côté du logo (ex. 0,5 × hauteur), ou valeur fixe en mm ; la zone suit la rotation du logo. Tout texte (vectorisé en coulisse pour mesurer les vraies lettres), image, forme, filet ou autre logo qui y entre est signalé, avec l'**espace libre réellement disponible en X** (ex. « 0,4 X au lieu de 1 X »). Un fond qui porte tout le logo est accepté ; un changement de fond (bord d'un aplat ou d'une photo) dans la zone est signalé en orange. Les objets masqués par un masque d'écrêtage ne comptent que pour leur partie visible ;
   - **bord du plan de travail** : logo coupé par le bord, ou zone de protection qui dépasse du plan (option) ;
   - **déformation** (proportions modifiées au-delà d'une tolérance en %), **inclinaison**, **miroir**, **rotation** (autorisée, 0°/90° seulement, ou interdite) ;
   - **couleurs** : couleurs d'origine, version noire, version blanche, version en une seule couleur — chacune autorisée ou non ; une couleur changée, inversée ou un dégradé ajouté est signalé ;
   - **transparence** : opacité < 100 % ou mode de fusion sur le logo, ses groupes parents ou son calque ;
   - **logo rogné** par un masque d'écrêtage ;
   - **forme retouchée** : une copie dont des points ont été déplacés (écart moyen en % de la taille).
4. **Résultat** : **Analyser** affiche le bilan sans rien ajouter au document ; **Contrôler** pose des repères sur le calque non imprimable **« Conformité logo – repères »** (cadre et zone en pointillés verts / orange / rouges, points rouges sur les objets qui empiètent, étiquette avec la liste des problèmes), sélectionne les logos à corriger et peut écrire un **rapport .txt** sur le Bureau. **Effacer les repères** supprime ce calque.

La référence peut être **mémorisée dans le document** (note de l'objet, panneau Attributs) : aux contrôles suivants, il suffit de lancer le script sans rien sélectionner. Les réglages de la charte sont gardés dans un petit fichier local (dossier des données utilisateur). Les logos posés hors des plans de travail (la référence sur la table de montage, par exemple) sont ignorés par défaut.

L'illustration n'est jamais modifiée : le script lit le document et ajoute seulement des repères.

## Pourquoi c'est nouveau

Vérifié le 16 octobre 2026 :

- **Illustrator** n'a aucune notion de charte de logo : rien ne retrouve les copies d'un logo tourné ou agrandi, ni ne contrôle une zone de protection ou une taille minimale. Sur Adobe Community, la seule piste est un bout de script qui compare la largeur d'objets sélectionnés par couleur de remplissage (« Script to select multiple objects that are all sized the same ») ; pour les symboles déformés, la réponse reste « regardez les pourcentages du panneau Transformation un par un ».
- **Les outils de logo pour Illustrator dessinent la zone, ils ne la contrôlent pas** : Anchr Grid (anchr.tools), Logo Grider (KareemStudio), Logo Clearspace Grid Generator (Scripthello, Gumroad) et le script de DTP Transit (note.com) génèrent la grille, la zone de protection et les tailles minimales du logo sélectionné pour la page de charte ; aucun ne parcourt un document pour trouver les copies et signaler ce qui empiète.
- **Les contrôles de conformité à la marque existent hors d'Illustrator**, sur des fichiers exportés et par analyse d'image (IA) : Adobe Brand Intelligence « Validate » (application web Firefly), Bynder Brand Compliance Agent, CreativeLens. Ils ne lisent pas le fichier .ai vectoriel ni ses transformations exactes, et ne posent pas de repères dans le document.
- **GitHub et auteurs connus** : aucune recherche (« clear space », « clearspace », « exclusion zone », « logo minimum size », « brand compliance », « logo distortion », dans du code `.jsx` ou utilisant `app.activeDocument`) ne renvoie de script Illustrator de contrôle ; rien chez creold, Hiroyuki Sato, John Wundes, Alexander Ladygin, wckdtall, Kelso Cartography, Josh Duncan ni dans les 209 scripts de vexy (seulement des scripts qui effacent les repères commentés). Le paquet `@genart-dev/plugin-identity` calcule une zone de protection pour ses propres logos générés, pas dans Illustrator.
- Idées écartées pendant cette recherche car déjà existantes : contrôle du contraste texte / fond selon les WCAG (ContrastChecker de creold, Contrast Checker de Samolevsky et de vexy, panneau ColorLens).

## Installation

- **Ponctuelle** : Fichier > Scripts > Autre script…, puis choisir `ConformiteLogo.jsx`.
- **Permanente** : copier le fichier dans le dossier `Presets/<langue>/Scripts` d'Illustrator (par exemple `Adobe Illustrator 2026/Presets/fr_FR/Scripts` sur macOS ou `C:\Program Files\Adobe\Adobe Illustrator 2026\Presets\fr_FR\Scripts` sur Windows), puis redémarrer Illustrator. Le script apparaît dans Fichier > Scripts.

## Utilisation

1. Travaillez sur une **copie** de votre fichier par prudence (le script ne modifie pas l'illustration).
2. Sélectionnez **un seul objet** : le logo de référence, groupé (Ctrl+G / Cmd+G), en version d'origine et non déformé — par exemple celui de la page de charte ou un logo posé sur la table de montage. Il peut aussi être une instance de symbole ou une image liée.
3. Lancez le script, saisissez les règles de la charte (taille minimale, facteur X de la zone de protection, versions de couleur autorisées, politique de rotation), puis **Analyser** ou **Contrôler**.
4. Corrigez les logos sélectionnés en vous aidant des étiquettes, puis relancez pour vérifier. **Effacer les repères** retire le calque de repères (ou supprimez-le à la main).

Limites connues : une copie dont on a dégroupé ou réorganisé les éléments, ajouté ou supprimé des points, ou dont les textes n'ont pas été vectorisés de la même façon n'est pas reconnue (elle n'est pas comptée). Pour une forme très simple (rectangle, cercle…), d'autres objets de même structure peuvent être pris pour des copies : le script prévient dans la fenêtre. Les effets (ombre portée, lueur…) ne sont pas détectés. Pour une image liée tournée, la zone de protection est calculée d'après la matrice de l'image (non vérifié dans Illustrator).

**Annuler** : le script n'ajoute qu'un calque de repères ; Ctrl+Z / Cmd+Z (plusieurs fois si besoin) ou **Effacer les repères**.

## Version cible et statut des tests

- Cible : Adobe Illustrator CC 2018 et plus récent (ExtendScript, Windows et macOS). Aucun appel réseau, aucune collecte de données.
- **Non testé dans Illustrator.**
- Syntaxe vérifiée avec acorn en mode ES3 et ES5 (`npx acorn --ecma3` et `--ecma5`).
- Calculs vérifiés sur données simulées (`tests/test-engine.js`, 65 tests) : ajustement affine et décomposition sur 500 transformations aléatoires (échelle, rotation, inclinaison, miroir), cas limites (points alignés, bruit), point dans un polygone et règle pair-impair, aplatissement des courbes de Bézier (cercle, erreur < 0,03 pt), obstacles (intrusion, fond, bord de fond, filet ouvert, bandeau sans sommet dans la zone, objet sur le logo, masque d'écrêtage), versions de couleur (originale, noire, blanche, une couleur, inversée, tons directs), et toutes les règles d'évaluation (taille, déformation, inclinaison, rotation 0/90 ou interdite, couleurs, opacité, masque, bord coupé, trop près du bord en X, zone fixe en mm, autre logo, copie tournée et agrandie).
- Logique Illustrator vérifiée sur objets simulés (`tests/test-simulation.js`, 41 tests) : document factice avec 18 logos (conforme, trop petit, déformé, tourné, miroir, texte trop près à 0,5 X, sur un fond, près du bord, version noire, couleurs inversées, rogné par un masque, opacité 50 %, deux logos collés, plan de travail 2 tourné à 90°, calque masqué, objet de structure différente), référence sur la table de montage, calque de repères non imprimable, étiquettes, sélection, note de référence et relance sans sélection, règles plus strictes, analyse sans modification, effacement, rapport et réglages, logo avec texte vivant vectorisé sur copie temporaire, document RVB, alertes (aucun document, aucune sélection, deux objets, type non géré), interface anglaise. Ces simulations ne remplacent pas un essai réel.

```
node tests/test-engine.js
node tests/test-simulation.js
```

## Licence

MIT — © 2026 Amirouche Amwanes. Voir [LICENSE](LICENSE).
