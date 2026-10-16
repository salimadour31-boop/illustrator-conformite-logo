/*
 * ConformiteLogo.jsx — v1.0.0
 * Contrôle de conformité des logos d'un document Adobe Illustrator
 * Logo compliance check for every logo placement in an Illustrator document
 *
 * FR : retrouve toutes les copies d'un logo de référence (copies collées, instances de symbole,
 *      liens vers le même fichier) dans le document et vérifie chacune selon la charte :
 *      taille minimale, zone de protection libre (aucun texte, image ou forme dedans),
 *      déformation, inclinaison, miroir, rotation, couleurs autorisées (originale, noir,
 *      blanc, monochrome), opacité / mode de fusion, logo rogné par un masque ou par le
 *      bord du plan de travail. Repères sur un calque non imprimable, rapport .txt.
 * EN : finds every copy of a reference logo (pasted copies, symbol instances, links to the
 *      same file) and checks each one against brand rules: minimum size, free clear space,
 *      distortion, skew, mirroring, rotation, allowed colour versions, opacity / blending,
 *      cropping by a clipping mask or the artboard edge. Markers on a non-printing layer.
 *
 * Auteur / Author : Amirouche Amwanes — Licence MIT (voir LICENSE)
 * Cible / Target : Illustrator CC 2018+ (ExtendScript ES3). Non testé dans Illustrator.
 * Aucun appel réseau, aucune collecte de données / No network access, no data collection.
 */
#target illustrator
#targetengine "ConformiteLogo"

//@@ENGINE_START
/* ---------------------------------------------------------------------------
 * Moteur de calcul (sans dépendance à Illustrator, testable hors logiciel)
 * Calculation engine (no Illustrator dependency, testable outside the app)
 * ------------------------------------------------------------------------- */
var CL = {};
CL.EPS = 1e-9;

/* Ajustement affine aux moindres carrés : Q ≈ A·P + t
 * Least-squares affine fit. P, Q : tableaux de [x, y] de même longueur. */
CL.fitAffine = function (P, Q) {
    var n = P.length, i;
    if (n < 3 || !Q || Q.length !== n) { return null; }
    var mpx = 0, mpy = 0, mqx = 0, mqy = 0;
    for (i = 0; i < n; i++) { mpx += P[i][0]; mpy += P[i][1]; mqx += Q[i][0]; mqy += Q[i][1]; }
    mpx /= n; mpy /= n; mqx /= n; mqy /= n;
    var sxx = 0, sxy = 0, syy = 0, ux = 0, uy = 0, vx = 0, vy = 0, px, py, qx, qy;
    for (i = 0; i < n; i++) {
        px = P[i][0] - mpx; py = P[i][1] - mpy; qx = Q[i][0] - mqx; qy = Q[i][1] - mqy;
        sxx += px * px; sxy += px * py; syy += py * py;
        ux += qx * px; uy += qx * py; vx += qy * px; vy += qy * py;
    }
    var det = sxx * syy - sxy * sxy;
    var tr = sxx + syy;
    if (tr <= CL.EPS || det <= 1e-10 * tr * tr) { return null; } // points alignés / collinear
    var a = (ux * syy - uy * sxy) / det, b = (uy * sxx - ux * sxy) / det;
    var c = (vx * syy - vy * sxy) / det, d = (vy * sxx - vx * sxy) / det;
    var e = mqx - a * mpx - b * mpy, f = mqy - c * mpx - d * mpy;
    var s2 = 0, rx, ry;
    for (i = 0; i < n; i++) {
        rx = a * P[i][0] + b * P[i][1] + e - Q[i][0];
        ry = c * P[i][0] + d * P[i][1] + f - Q[i][1];
        s2 += rx * rx + ry * ry;
    }
    return { a: a, b: b, c: c, d: d, e: e, f: f, rms: Math.sqrt(s2 / n) };
};

CL.applyT = function (T, x, y) { return [T.a * x + T.b * y + T.e, T.c * x + T.d * y + T.f]; };

/* Décomposition A = R(θ) · [sx k ; 0 sy] — rotation, échelles, cisaillement, miroir */
CL.decompose = function (T) {
    var sx = Math.sqrt(T.a * T.a + T.c * T.c);
    var th = Math.atan2(T.c, T.a), co = Math.cos(th), si = Math.sin(th);
    var k = T.b * co + T.d * si;
    var sy = -T.b * si + T.d * co;
    var det = T.a * T.d - T.b * T.c;
    var asy = Math.abs(sy);
    var rot = th * 180 / Math.PI;
    if (rot <= -180) { rot += 360; }
    return {
        sx: sx, sy: sy, rotation: rot, flip: det < 0,
        distortion: sx > CL.EPS ? asy / sx : 1,
        skew: asy > CL.EPS ? Math.atan(k / asy) * 180 / Math.PI : 90,
        scale: Math.sqrt(Math.abs(det))
    };
};

/* Écart angulaire minimal à un multiple de "step" degrés */
CL.angleOff = function (deg, step) {
    var r = deg % step; if (r < 0) { r += step; }
    return Math.min(r, step - r);
};

/* Rectangle [gauche, haut, droite, bas] (y vers le haut) -> quadrilatère transformé */
CL.rectQuad = function (r, T) {
    var pts = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]], out = [], i;
    for (i = 0; i < 4; i++) { out.push(T ? CL.applyT(T, pts[i][0], pts[i][1]) : pts[i]); }
    return out;
};
CL.expandRect = function (r, m) { return [r[0] - m, r[1] + m, r[2] + m, r[3] - m]; };
CL.polyBounds = function (pts) {
    var l = Infinity, t = -Infinity, rr = -Infinity, b = Infinity, i;
    for (i = 0; i < pts.length; i++) {
        if (pts[i][0] < l) { l = pts[i][0]; } if (pts[i][0] > rr) { rr = pts[i][0]; }
        if (pts[i][1] > t) { t = pts[i][1]; } if (pts[i][1] < b) { b = pts[i][1]; }
    }
    return [l, t, rr, b];
};
CL.rectsIntersect = function (a, b) {
    return !(a[2] < b[0] || b[2] < a[0] || a[1] < b[3] || b[1] < a[3]);
};
CL.rectIntersection = function (a, b) {
    if (!a) { return b; } if (!b) { return a; }
    var r = [Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3])];
    if (r[0] > r[2] || r[3] > r[1]) { return [0, 0, 0, 0, true]; } // vide / empty
    return r;
};
CL.inRect = function (p, r, tol) {
    tol = tol || 0;
    return p[0] >= r[0] - tol && p[0] <= r[2] + tol && p[1] <= r[1] + tol && p[1] >= r[3] - tol;
};
CL.rectContainsRect = function (outer, inner, tol) {
    tol = tol || 0;
    return inner[0] >= outer[0] - tol && inner[2] <= outer[2] + tol && inner[1] <= outer[1] + tol && inner[3] >= outer[3] - tol;
};

/* Point dans un polygone (règle pair-impair / even-odd) */
CL.pointInPoly = function (p, poly) {
    var inside = false, i, j, xi, yi, xj, yj, n = poly.length;
    for (i = 0, j = n - 1; i < n; j = i++) {
        xi = poly[i][0]; yi = poly[i][1]; xj = poly[j][0]; yj = poly[j][1];
        if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) { inside = !inside; }
    }
    return inside;
};
/* Pair-impair sur plusieurs contours (tracé transparent) */
CL.pointInPolys = function (p, polys) {
    var k, c = 0;
    for (k = 0; k < polys.length; k++) { if (polys[k].closed !== false && CL.pointInPoly(p, polys[k].pts)) { c++; } }
    return (c % 2) === 1;
};
CL.segIntersect = function (p1, p2, p3, p4) {
    var d1x = p2[0] - p1[0], d1y = p2[1] - p1[1], d2x = p4[0] - p3[0], d2y = p4[1] - p3[1];
    var den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < CL.EPS) { return null; }
    var t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / den;
    var u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) { return null; }
    return [p1[0] + t * d1x, p1[1] + t * d1y];
};
CL.distPointSeg = function (p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = 0;
    if (l2 > CL.EPS) { t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2; if (t < 0) { t = 0; } else if (t > 1) { t = 1; } }
    var x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
    return Math.sqrt(x * x + y * y);
};
/* Distance d'un point au quadrilatère du logo (0 si dedans) */
CL.distPointQuad = function (p, q) {
    if (CL.pointInPoly(p, q)) { return 0; }
    var m = Infinity, i, d;
    for (i = 0; i < q.length; i++) { d = CL.distPointSeg(p, q[i], q[(i + 1) % q.length]); if (d < m) { m = d; } }
    return m;
};

/* Aplatissement d'un tracé de Bézier : pts = [[ax, ay, lx, ly, rx, ry], ...] */
CL.flatten = function (pts, closed, step) {
    var out = [], n = pts.length, i, j, segs, a, b, t, mt, x, y, len, last;
    if (n === 0) { return out; }
    step = step > 0 ? step : 2;
    last = closed ? n : n - 1;
    out.push([pts[0][0], pts[0][1]]);
    for (i = 0; i < last; i++) {
        a = pts[i]; b = pts[(i + 1) % n];
        var straight = Math.abs(a[4] - a[0]) < 1e-6 && Math.abs(a[5] - a[1]) < 1e-6 && Math.abs(b[2] - b[0]) < 1e-6 && Math.abs(b[3] - b[1]) < 1e-6;
        len = Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
        if (straight) {
            segs = Math.min(200, Math.max(1, Math.ceil(len / step)));
        } else {
            var hl = len + Math.sqrt((a[4] - a[0]) * (a[4] - a[0]) + (a[5] - a[1]) * (a[5] - a[1])) + Math.sqrt((b[2] - b[0]) * (b[2] - b[0]) + (b[3] - b[1]) * (b[3] - b[1]));
            segs = Math.min(200, Math.max(8, Math.ceil(hl / step)));
        }
        for (j = 1; j <= segs; j++) {
            t = j / segs; mt = 1 - t;
            if (straight) {
                x = a[0] + (b[0] - a[0]) * t; y = a[1] + (b[1] - a[1]) * t;
            } else {
                x = mt * mt * mt * a[0] + 3 * mt * mt * t * a[4] + 3 * mt * t * t * b[2] + t * t * t * b[0];
                y = mt * mt * mt * a[1] + 3 * mt * mt * t * a[5] + 3 * mt * t * t * b[3] + t * t * t * b[1];
            }
            out.push([x, y]);
        }
    }
    if (closed && out.length > 1) { out.pop(); }
    return out;
};

/* Échantillonnage régulier : mêmes indices pour la référence et la copie */
CL.sampleIdx = function (n, max) {
    var idx = [], i;
    if (n <= max) { for (i = 0; i < n; i++) { idx.push(i); } return idx; }
    for (i = 0; i < max; i++) { idx.push(Math.floor(i * n / max)); }
    return idx;
};

/* Analyse d'un obstacle par rapport à la zone de protection
 * polys : [{pts:[[x,y]...], closed:bool}] déjà aplatis ; zone, logo : quadrilatères ;
 * clip : rectangle visible (masque) ou null ; filled : objet peint (peut servir de fond). */
CL.analyseObstacle = function (polys, zone, logo, clip, filled, centre) {
    var res = { points: [], minDist: Infinity, containsZone: false, containsCentre: false, kind: 'none' };
    var k, i, P, a, b, e, x, q, dd, last;
    function keep(p) {
        if (clip && (clip[4] || !CL.inRect(p, clip, 0.01))) { return; }
        res.points.push(p);
        dd = CL.distPointQuad(p, logo);
        if (dd < res.minDist) { res.minDist = dd; }
    }
    var zbx = CL.polyBounds(zone), zd = Math.sqrt((zbx[2] - zbx[0]) * (zbx[2] - zbx[0]) + (zbx[1] - zbx[3]) * (zbx[1] - zbx[3])) / 80, sb, len, ns, j, sp;
    for (k = 0; k < polys.length; k++) {
        P = polys[k].pts;
        for (i = 0; i < P.length; i++) { if (CL.pointInPoly(P[i], zone)) { keep(P[i]); } }
        last = polys[k].closed === false ? P.length - 1 : P.length;
        for (i = 0; i < last; i++) {
            a = P[i]; b = P[(i + 1) % P.length];
            sb = [Math.min(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[0], b[0]), Math.min(a[1], b[1])];
            if (!CL.rectsIntersect(sb, zbx)) { continue; }
            for (e = 0; e < 4; e++) {
                x = CL.segIntersect(a, b, zone[e], zone[(e + 1) % 4]);
                if (x) { keep(x); }
            }
            // points intermédiaires des longs côtés / samples along long edges
            len = Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
            ns = zd > 0 ? Math.min(400, Math.floor(len / zd)) : 0;
            for (j = 1; j < ns; j++) {
                sp = [a[0] + (b[0] - a[0]) * j / ns, a[1] + (b[1] - a[1]) * j / ns];
                if (CL.pointInPoly(sp, zone)) { keep(sp); }
            }
        }
    }
    if (filled && centre) {
        // un fond doit porter tout le logo / a background must hold the whole logo
        res.containsCentre = CL.pointInPolys(centre, polys) && CL.pointInPolys(logo[0], polys) && CL.pointInPolys(logo[1], polys) && CL.pointInPolys(logo[2], polys) && CL.pointInPolys(logo[3], polys);
        var all = true;
        for (q = 0; q < 4; q++) { if (!CL.pointInPolys(zone[q], polys)) { all = false; break; } }
        res.containsZone = all;
    }
    if (res.points.length === 0) {
        res.kind = (filled && res.containsZone) ? 'background' : 'none';
        if (res.kind === 'background' && clip && !clip[4]) {
            // le masque peut ne couvrir qu'une partie de la zone / the mask may cover only part of the zone
            var zb = CL.polyBounds(zone);
            if (!CL.rectContainsRect(clip, zb, 0.01)) {
                var corners = CL.rectQuad(clip), inside = false;
                for (q = 0; q < 4; q++) { if (CL.pointInPoly(corners[q], zone)) { inside = true; res.points.push(corners[q]); } }
                if (inside || CL.rectsIntersect(clip, zb)) { res.kind = 'backgroundEdge'; }
            }
        }
    } else {
        res.kind = (filled && res.containsCentre) ? 'backgroundEdge' : 'intrusion';
    }
    return res;
};

/* Couleurs : objets simples {t:'c'|'r'|'g'|'s'|'G'|'P'|'l'|'?', v:[...], n:'nom'} */
CL.sameColor = function (x, y, tol) {
    var i;
    if (!x || !y) { return !x && !y; }
    if (x.t !== y.t) { return false; }
    if (x.t === 's' || x.t === 'G' || x.t === 'P') {
        if (x.n !== y.n) { return false; }
        if (x.t !== 's') { return true; }
    }
    if (!x.v || !y.v) { return !x.v && !y.v; }
    if (x.v.length !== y.v.length) { return false; }
    for (i = 0; i < x.v.length; i++) { if (Math.abs(x.v[i] - y.v[i]) > tol) { return false; } }
    return true;
};
CL.colorClass = function (x) {
    if (!x) { return 'none'; }
    var v = x.v;
    if (x.t === 'c') {
        if (v[3] >= 95 && v[0] <= 10 && v[1] <= 10 && v[2] <= 10) { return 'black'; }
        if (v[3] >= 99 && v[0] <= 70 && v[1] <= 70 && v[2] <= 70) { return 'black'; } // noir riche / rich black
        if (v[0] <= 1 && v[1] <= 1 && v[2] <= 1 && v[3] <= 1) { return 'white'; }
    } else if (x.t === 'r') {
        if (v[0] <= 30 && v[1] <= 30 && v[2] <= 30) { return 'black'; }
        if (v[0] >= 245 && v[1] >= 245 && v[2] >= 245) { return 'white'; }
    } else if (x.t === 'g') {
        if (v[0] >= 95) { return 'black'; }
        if (v[0] <= 1) { return 'white'; }
    } else if (x.t === 's') {
        if (/black|noir|schwarz|nero|negro/i.test(x.n) && v && v[0] >= 95) { return 'black'; }
        if (/white|blanc|weiss|bianco|blanco/i.test(x.n)) { return 'white'; }
        if (v && v[0] <= 1) { return 'white'; }
    }
    return 'other';
};
/* Version de couleur d'une copie : 'original', 'black', 'white', 'mono', 'other' */
CL.colorVersion = function (refCols, candCols, tol) {
    var i, j, same = refCols.length === candCols.length, distinct = [], found, diffs = 0;
    if (same) {
        for (i = 0; i < refCols.length; i++) { if (!CL.sameColor(refCols[i], candCols[i], tol)) { same = false; break; } }
    }
    if (same) { return { version: 'original', diffs: 0 }; }
    for (i = 0; i < candCols.length; i++) {
        if (i >= refCols.length || !CL.sameColor(refCols[i], candCols[i], tol)) { diffs++; }
        if (!candCols[i]) { continue; }
        found = false;
        for (j = 0; j < distinct.length; j++) { if (CL.sameColor(distinct[j], candCols[i], tol)) { found = true; break; } }
        if (!found) { distinct.push(candCols[i]); }
    }
    if (distinct.length === 1) {
        var cls = CL.colorClass(distinct[0]);
        if (cls === 'black' || cls === 'white') { return { version: cls, diffs: diffs, color: distinct[0] }; }
        return { version: 'mono', diffs: diffs, color: distinct[0] };
    }
    return { version: 'other', diffs: diffs, count: distinct.length };
};
CL.colorLabel = function (x) {
    if (!x) { return '-'; }
    var r = function (n) { return Math.round(n); };
    if (x.t === 'c') { return 'C' + r(x.v[0]) + ' M' + r(x.v[1]) + ' J' + r(x.v[2]) + ' N' + r(x.v[3]); }
    if (x.t === 'r') { return 'R' + r(x.v[0]) + ' V' + r(x.v[1]) + ' B' + r(x.v[2]); }
    if (x.t === 'g') { return 'Gris ' + r(x.v[0]) + ' %'; }
    if (x.t === 's') { return x.n + (x.v ? ' ' + r(x.v[0]) + ' %' : ''); }
    if (x.t === 'G') { return 'Dégradé ' + x.n; }
    if (x.t === 'P') { return 'Motif ' + x.n; }
    return '?';
};

/* Unités / units */
CL.PT_PER_MM = 72 / 25.4;
CL.toUnit = function (pt, unit) { return unit === 'mm' ? pt / CL.PT_PER_MM : pt; };
CL.fromUnit = function (v, unit) { return unit === 'mm' ? v * CL.PT_PER_MM : v; };
CL.parseNum = function (s) {
    var v = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
    return isNaN(v) ? null : v;
};
CL.fmt = function (v, dec, comma) {
    var p = Math.pow(10, dec), s = String(Math.round(v * p) / p);
    return comma ? s.replace('.', ',') : s;
};

/* Valeur de X dans l'espace de la référence / X in reference space */
CL.zoneUnit = function (rules, refW, refH, dec) {
    var base;
    if (rules.xBase === 'fixed') { return (rules.xFixedMm * CL.PT_PER_MM) / Math.max(dec.scale, CL.EPS); }
    if (rules.xBase === 'width') { base = refW; } else if (rules.xBase === 'min') { base = Math.min(refW, refH); } else { base = refH; }
    return base * rules.xFactor;
};

/* Évaluation d'une copie de logo à partir de données simples / evaluation from plain data
 * cand : {T, refRect, refW, refH, artRect, maskRect, opacityIssue, cols, refCols, shapeRms,
 *         obstacles:[{label, res}], otherLogos:[quad...]}
 * Retourne {issues:[{sev, code, text}], severity, logoQuad, zoneQuad, X, w, h, dec} */
CL.evaluate = function (cand, rules, L) {
    var dec = CL.decompose(cand.T), issues = [];
    var w = cand.refW * dec.sx, h = cand.refH * Math.abs(dec.sy);
    var Xref = CL.zoneUnit(rules, cand.refW, cand.refH, dec);
    var logoQuad = CL.rectQuad(cand.refRect, cand.T);
    var zoneQuad = CL.rectQuad(CL.expandRect(cand.refRect, Xref), cand.T);
    var Xdoc = Xref * dec.scale;
    var i, e, d, dim;
    L = L || function (k) { return k; };
    function add(sev, code, text) { issues.push({ sev: sev, code: code, text: text }); }
    // Taille minimale / minimum size
    if (rules.minSize > 0) {
        dim = rules.minDim === 'height' ? h : (rules.minDim === 'min' ? Math.min(w, h) : w);
        var minPt = CL.fromUnit(rules.minSize, rules.minUnit);
        if (dim < minPt - 1e-6) { add(2, 'size', L('issueSize', CL.toUnit(dim, rules.minUnit), rules.minSize, rules.minUnit)); }
    }
    // Déformation, inclinaison, miroir, rotation / distortion, skew, mirror, rotation
    if (Math.abs(dec.distortion - 1) * 100 > rules.distTol) { add(2, 'distort', L('issueDistort', (dec.distortion - 1) * 100)); }
    if (Math.abs(dec.skew) > rules.skewTol) { add(2, 'skew', L('issueSkew', dec.skew)); }
    if (dec.flip) { add(2, 'flip', L('issueFlip')); }
    if (!dec.flip && rules.rotPolicy !== 'any') {
        var off = rules.rotPolicy === 'right' ? CL.angleOff(dec.rotation, 90) : CL.angleOff(dec.rotation, 360);
        if (off > rules.skewTol) { add(rules.rotPolicy === 'none' ? 2 : 1, 'rotate', L('issueRotate', dec.rotation)); }
    }
    if (rules.shapeTol > 0 && cand.shapeRms !== undefined && cand.shapeRms !== null) {
        var diag = Math.sqrt(w * w + h * h);
        if (diag > 0 && cand.shapeRms / diag * 100 > rules.shapeTol) { add(1, 'shape', L('issueShape', cand.shapeRms / diag * 100)); }
    }
    // Couleurs / colours
    var cv = null;
    if (rules.checkColors && cand.cols) {
        cv = CL.colorVersion(cand.refCols || [], cand.cols, 1.5);
        var ok = (cv.version === 'original' && rules.allowOriginal) || (cv.version === 'black' && (rules.allowBlack || rules.allowMono)) ||
                 (cv.version === 'white' && (rules.allowWhite || rules.allowMono)) || (cv.version === 'mono' && rules.allowMono);
        if (!ok) { add(2, 'colors', L('issueColors', cv)); }
    }
    if (rules.checkOpacity && cand.opacityIssue) { add(2, 'opacity', L('issueOpacity', cand.opacityIssue)); }
    // Rognage / cropping
    var lb = CL.polyBounds(logoQuad);
    if (rules.checkCrop && cand.maskRect) {
        if (cand.maskRect[4] || !CL.rectContainsRect(cand.maskRect, lb, 0.5)) { add(2, 'mask', L('issueMask')); }
    }
    var edgeDist = Infinity;
    if (cand.artRect) {
        var outLogo = false, outZone = false, ar = cand.artRect;
        for (i = 0; i < 4; i++) {
            if (!CL.inRect(logoQuad[i], ar, 0.01)) { outLogo = true; }
            if (!CL.inRect(zoneQuad[i], ar, 0.01)) { outZone = true; }
        }
        if (rules.checkCrop && outLogo) { add(2, 'edgeCut', L('issueEdgeCut')); }
        else if (rules.edgeIsObstacle && outZone && !outLogo) {
            for (i = 0; i < 4; i++) {
                d = Math.min(logoQuad[i][0] - ar[0], ar[2] - logoQuad[i][0], ar[1] - logoQuad[i][1], logoQuad[i][1] - ar[3]);
                if (d < edgeDist) { edgeDist = d; }
            }
            add(2, 'edge', L('issueEdge', edgeDist / Math.max(Xdoc, CL.EPS)));
        }
    }
    // Zone de protection / clear space
    var intr = 0, edges = 0, minD = Infinity, names = [];
    if (cand.obstacles) {
        for (i = 0; i < cand.obstacles.length; i++) {
            var o = cand.obstacles[i];
            if (o.res.kind === 'intrusion') { intr++; if (o.res.minDist < minD) { minD = o.res.minDist; } if (names.length < 4) { names.push(o.label); } }
            else if (o.res.kind === 'backgroundEdge') { edges++; }
        }
    }
    if (cand.otherLogos) {
        for (i = 0; i < cand.otherLogos.length; i++) {
            var ob = CL.analyseObstacle([{ pts: cand.otherLogos[i], closed: true }], zoneQuad, logoQuad, null, false, null);
            if (ob.kind === 'intrusion') { intr++; if (ob.minDist < minD) { minD = ob.minDist; } if (names.length < 4) { names.push(L('otherLogo')); } }
        }
    }
    if (intr > 0) { add(2, 'clear', L('issueClear', intr, minD / Math.max(Xdoc, CL.EPS), names)); }
    if (edges > 0) { add(1, 'bgEdge', L('issueBgEdge', edges)); }
    var sev = 0;
    for (i = 0; i < issues.length; i++) { if (issues[i].sev > sev) { sev = issues[i].sev; } }
    return { issues: issues, severity: sev, logoQuad: logoQuad, zoneQuad: zoneQuad, X: Xdoc, Xref: Xref, w: w, h: h, dec: dec,
             colorVersion: cv ? cv.version : null, minClear: Math.min(minD, edgeDist) };
};
//@@ENGINE_END

/* ---------------------------------------------------------------------------
 * Textes de l'interface / UI strings (FR / EN)
 * ------------------------------------------------------------------------- */
var CLUI = {};
CLUI.fr = (function () {
    var lang = 'en';
    try { lang = String(app.locale || 'en').substr(0, 2).toLowerCase(); } catch (e) { lang = 'en'; }
    return lang === 'fr';
})();
CLUI.T = {
    title: ['Conformité du logo', 'Logo compliance'],
    noDoc: ['Aucun document ouvert.\nOuvrez un document puis relancez le script.', 'No document is open.\nOpen a document and run the script again.'],
    noRef: ['Sélectionnez le logo de référence (un groupe, un tracé, une instance de symbole ou une image liée), puis relancez le script.\n\nAstuce : cochez « Mémoriser comme référence » pour ne plus avoir à le sélectionner.',
            'Select the reference logo (a group, a path, a symbol instance or a linked image), then run the script again.\n\nTip: tick "Remember as reference" so you do not have to select it next time.'],
    oneRef: ['Sélectionnez un seul objet : le logo de référence (groupez-le au besoin, Ctrl+G).', 'Select a single object: the reference logo (group it first if needed, Ctrl+G).'],
    badRef: ['Ce type d\'objet ne peut pas servir de référence : ', 'This kind of object cannot be used as a reference: '],
    clearAsk: ['Aucun logo de référence sélectionné. Effacer les repères existants ?', 'No reference logo selected. Clear the existing markers?'],
    refPanel: ['Logo de référence', 'Reference logo'],
    refStored: [' (mémorisé dans le document)', ' (remembered in the document)'],
    remember: ['Mémoriser comme référence dans le document (note de l\'objet)', 'Remember as reference in the document (object note)'],
    weakRef: ['Attention : forme très simple (moins de 12 points), risque de fausses correspondances.', 'Warning: very simple shape (fewer than 12 points), false matches are possible.'],
    rules: ['Règles de la charte', 'Brand rules'],
    minSize: ['Taille minimale :', 'Minimum size:'],
    ofDim: ['de', 'for'],
    dims: [['largeur', 'hauteur', 'plus petit côté'], ['width', 'height', 'smaller side']],
    zone: ['Zone de protection : X =', 'Clear space: X ='],
    times: ['×', '×'],
    bases: [['hauteur du logo', 'largeur du logo', 'plus petit côté', 'valeur fixe en mm'], ['logo height', 'logo width', 'smaller side', 'fixed value in mm']],
    fixedMm: ['Valeur fixe (mm) :', 'Fixed value (mm):'],
    edgeObs: ['Le bord du plan de travail compte comme un obstacle', 'The artboard edge counts as an obstacle'],
    skipPaste: ['Ignorer les logos posés hors des plans de travail', 'Ignore logos lying outside the artboards'],
    checks: ['Contrôles', 'Checks'],
    distort: ['Déformation (tolérance %) :', 'Distortion (tolerance %):'],
    skewTol: ['Inclinaison / rotation (tolérance °) :', 'Skew / rotation (tolerance °):'],
    rot: ['Rotation :', 'Rotation:'],
    rots: [['autorisée', '0° / 90° seulement', 'interdite'], ['allowed', '0° / 90° only', 'not allowed']],
    colors: ['Contrôler les couleurs — versions autorisées :', 'Check colours — allowed versions:'],
    cOrig: ['couleurs d\'origine', 'original colours'],
    cBlack: ['noir', 'black'],
    cWhite: ['blanc', 'white'],
    cMono: ['une seule couleur', 'one colour'],
    opac: ['Opacité < 100 % ou mode de fusion', 'Opacity < 100% or blending mode'],
    crop: ['Logo rogné (masque, bord du plan de travail)', 'Cropped logo (mask, artboard edge)'],
    shape: ['Forme retouchée (écart en % de la taille) :', 'Edited shape (deviation in % of size):'],
    output: ['Résultat', 'Output'],
    markers: ['Repères sur un calque non imprimable', 'Markers on a non-printing layer'],
    selectBad: ['Sélectionner les logos à corriger', 'Select the logos to fix'],
    report: ['Enregistrer un rapport .txt (sur le Bureau)', 'Save a .txt report (on the Desktop)'],
    tipCopy: ['Conseil : travaillez sur une copie du fichier. Le script ne modifie pas l\'illustration ; il ajoute seulement des repères (Effacer les repères les retire).', 'Tip: work on a copy of the file. The script does not change the artwork; it only adds markers (Clear markers removes them).'],
    analyse: ['Analyser', 'Analyse'],
    run: ['Contrôler', 'Check'],
    clear: ['Effacer les repères', 'Clear markers'],
    cancel: ['Annuler', 'Cancel'],
    cleared: ['Repères effacés.', 'Markers cleared.'],
    noneFound: ['Aucune copie du logo trouvée sur les plans de travail.', 'No copy of the logo was found on the artboards.'],
    summary: ['%1 logo(s) contrôlé(s) : %2 conforme(s), %3 à vérifier, %4 non conforme(s).', '%1 logo(s) checked: %2 compliant, %3 to review, %4 non-compliant.'],
    skipped: ['%1 logo(s) hors plan de travail ignoré(s).', '%1 logo(s) outside artboards ignored.'],
    unread: ['%1 copie(s) illisible(s) ignorée(s) (structure différente après vectorisation).', '%1 unreadable copy(ies) ignored (different structure after outlining).'],
    logoN: ['Logo %1', 'Logo %1'],
    onAb: ['plan « %1 »', 'artboard "%1"'],
    pasteboard: ['table de montage', 'pasteboard'],
    sizeInfo: ['%1 × %2 mm (%3 %)', '%1 × %2 mm (%3%)'],
    ok: ['conforme', 'compliant'],
    issueSize: ['trop petit : %1 %3 au lieu de %2 %3 minimum', 'too small: %1 %3 instead of %2 %3 minimum'],
    issueDistort: ['déformé : proportions modifiées de %1 %', 'distorted: proportions changed by %1%'],
    issueSkew: ['incliné de %1°', 'skewed by %1°'],
    issueFlip: ['en miroir (symétrie)', 'mirrored (reflected)'],
    issueRotate: ['tourné de %1°', 'rotated by %1°'],
    issueShape: ['forme retouchée (écart moyen %1 % de la taille)', 'shape edited (mean deviation %1% of size)'],
    issueColors: ['couleurs non autorisées : %1', 'colours not allowed: %1'],
    cvOther: ['%1 couleurs, %2 surface(s) modifiée(s)', '%1 colours, %2 surface(s) changed'],
    cvMono: ['une seule couleur (%1)', 'one colour (%1)'],
    cvBlack: ['version noire', 'black version'],
    cvWhite: ['version blanche', 'white version'],
    issueOpacity: ['transparence : %1', 'transparency: %1'],
    issueMask: ['rogné par un masque d\'écrêtage', 'cropped by a clipping mask'],
    issueEdgeCut: ['coupé par le bord du plan de travail', 'cut by the artboard edge'],
    issueEdge: ['trop près du bord : %1 X au lieu de 1 X', 'too close to the edge: %1 X instead of 1 X'],
    issueClear: ['zone de protection occupée par %1 objet(s), espace libre %2 X au lieu de 1 X (%3)', 'clear space intruded by %1 object(s), free space %2 X instead of 1 X (%3)'],
    issueBgEdge: ['changement de fond dans la zone de protection (%1)', 'background change inside the clear space (%1)'],
    otherLogo: ['autre logo', 'other logo'],
    kText: ['texte', 'text'],
    kImage: ['image', 'image'],
    kShape: ['forme', 'shape'],
    kSymbol: ['symbole', 'symbol'],
    kOther: ['objet', 'object'],
    layerName: ['Conformité logo – repères', 'Logo compliance – markers'],
    refLabel: ['RÉFÉRENCE', 'REFERENCE'],
    reportSaved: ['Rapport enregistré :\n', 'Report saved:\n'],
    badNum: ['Valeur incorrecte : ', 'Invalid value: '],
    error: ['Erreur : ', 'Error: '],
    more: ['… et %1 autre(s) — voir le rapport.', '… and %1 more — see the report.'],
    typeArt: ['dessin vectoriel', 'vector artwork'],
    typeSymbol: ['instance du symbole « %1 »', 'instance of symbol "%1"'],
    typePlaced: ['image liée « %1 »', 'linked image "%1"'],
    typeRaster: ['image incorporée (seule la référence est contrôlée)', 'embedded image (only the reference is checked)'],
    refDesc: ['%1 — %2 × %3 mm, %4 points', '%1 — %2 × %3 mm, %4 points'],
    reportHead: ['Contrôle de conformité du logo', 'Logo compliance check'],
    analyseOnly: ['(analyse seule : rien n\'a été ajouté au document)', '(analysis only: nothing was added to the document)']
};
function L(key) {
    var v = CLUI.T[key], s, i, a = arguments, fr = CLUI.fr;
    if (!v) { return key; }
    s = fr ? v[0] : v[1];
    if (typeof s !== 'string') { return s; }
    if (key === 'issueSize') { return s.replace('%1', CL.fmt(a[1], 1, fr)).replace('%2', CL.fmt(a[2], 1, fr)).replace(/%3/g, a[3] === 'mm' ? 'mm' : 'pt'); }
    if (key === 'issueDistort' || key === 'issueSkew' || key === 'issueRotate' || key === 'issueShape') { return s.replace('%1', CL.fmt(a[1], 1, fr)); }
    if (key === 'issueEdge') { return s.replace('%1', CL.fmt(Math.max(0, a[1]), 2, fr)); }
    if (key === 'issueClear') { return s.replace('%1', a[1]).replace('%2', CL.fmt(Math.max(0, a[2]), 2, fr)).replace('%3', a[3].join(', ')); }
    if (key === 'issueColors') {
        var cv = a[1], t;
        if (cv.version === 'black') { t = L('cvBlack'); }
        else if (cv.version === 'white') { t = L('cvWhite'); }
        else if (cv.version === 'mono') { t = L('cvMono').replace('%1', CL.colorLabel(cv.color)); }
        else { t = L('cvOther').replace('%1', cv.count).replace('%2', cv.diffs); }
        return s.replace('%1', t);
    }
    for (i = 1; i < a.length; i++) { s = s.replace('%' + i, a[i]); }
    return s;
}

/* ---------------------------------------------------------------------------
 * Lecture du document / Document reading
 * ------------------------------------------------------------------------- */
var REF_TAG = '[ConformiteLogo:ref]';
var MARK_LAYER_FR = 'Conformité logo – repères', MARK_LAYER_EN = 'Logo compliance – markers', TMP_LAYER = '__ConformiteLogo_tmp';

function safe(f, dflt) { try { return f(); } catch (e) { return dflt; } }

function colorObj(col) {
    if (!col) { return null; }
    var t = safe(function () { return col.typename; }, '');
    if (t === 'NoColor' || t === '') { return null; }
    if (t === 'CMYKColor') { return { t: 'c', v: [col.cyan, col.magenta, col.yellow, col.black] }; }
    if (t === 'RGBColor') { return { t: 'r', v: [col.red, col.green, col.blue] }; }
    if (t === 'GrayColor') { return { t: 'g', v: [col.gray] }; }
    if (t === 'SpotColor') { return { t: 's', n: safe(function () { return col.spot.name; }, '?'), v: [col.tint] }; }
    if (t === 'GradientColor') { return { t: 'G', n: safe(function () { return col.gradient.name; }, '?') }; }
    if (t === 'PatternColor') { return { t: 'P', n: safe(function () { return col.pattern.name; }, '?') }; }
    if (t === 'LabColor') { return { t: 'l', v: [col.l, col.a, col.b] }; }
    return { t: '?' };
}

function fileNameOf(item) { return safe(function () { return decodeURI(item.file.name); }, '(?)'); }

/* Transparence d'un objet (opacité, mode de fusion) / transparency of one object */
function transpOf(item) {
    var parts = [], o = safe(function () { return item.opacity; }, 100), bm = safe(function () { return String(item.blendingMode); }, '');
    if (o < 99.5) { parts.push(CL.fmt(o, 0) + ' %'); }
    if (bm && bm !== 'BlendModes.NORMAL' && bm !== 'NORMAL') { parts.push(bm.replace('BlendModes.', '')); }
    return parts.join(', ');
}
function joinT(a, b) { return a && b ? a + ', ' + b : (a || b); }

/* Signature de structure (indépendante de la position, de la taille et des couleurs)
 * Structure signature (independent of position, size and colours) */
function tokenOf(item) {
    var t = item.typename, i, parts;
    if (t === 'PathItem') { return (item.clipping ? 'k' : 'p') + item.pathPoints.length + (item.closed ? 'c' : 'o'); }
    if (t === 'CompoundPathItem') {
        parts = [];
        for (i = 0; i < item.pathItems.length; i++) { parts.push(tokenOf(item.pathItems[i])); }
        return 'C(' + parts.join(',') + ')';
    }
    if (t === 'TextFrame') { return 't:' + String(item.contents).replace(/\s+/g, ' ').substr(0, 60); }
    if (t === 'PlacedItem') { return 'i:' + fileNameOf(item); }
    if (t === 'RasterItem') { return 'r'; }
    if (t === 'SymbolItem') { return 's:' + safe(function () { return item.symbol.name; }, '?'); }
    if (t === 'GroupItem') {
        parts = [];
        for (i = 0; i < item.pageItems.length; i++) { if (!item.pageItems[i].hidden) { parts.push(tokenOf(item.pageItems[i])); } }
        return 'G(' + parts.join(',') + ')';
    }
    return t.substr(0, 3);
}
function needsRealArt(sig) { return sig.indexOf('t:') >= 0 || sig.indexOf('s:') >= 0; }

function pathData(p) {
    var pts = [], i, pp, n = p.pathPoints.length;
    for (i = 0; i < n; i++) {
        pp = p.pathPoints[i];
        pts.push([pp.anchor[0], pp.anchor[1], pp.leftDirection[0], pp.leftDirection[1], pp.rightDirection[0], pp.rightDirection[1]]);
    }
    return pts;
}

/* Parcourt les feuilles visibles dans un ordre stable / visits visible leaves in a stable order
 * fn(leaf, compound, firstOfCompound) */
function eachLeaf(item, fn) {
    var t = item.typename, i;
    if (item.hidden) { return; }
    if (t === 'GroupItem') { for (i = 0; i < item.pageItems.length; i++) { eachLeaf(item.pageItems[i], fn); } }
    else if (t === 'CompoundPathItem') { for (i = 0; i < item.pathItems.length; i++) { fn(item.pathItems[i], item, i === 0); } }
    else { fn(item, null, true); }
}

/* Points d'ancrage (ajustement), couleurs et transparence d'un dessin vectoriel */
function artGeometry(item) {
    var pts = [], cols = [], nPts = 0, tr = '';
    eachLeaf(item, function (leaf, compound, first) {
        if (leaf.typename === 'PathItem') {
            if (leaf.guides) { return; }
            var n = leaf.pathPoints.length, i, a;
            for (i = 0; i < n; i++) { a = leaf.pathPoints[i].anchor; pts.push([a[0], a[1]]); }
            nPts += n;
            if (!leaf.clipping && first) {
                cols.push(leaf.filled ? colorObj(leaf.fillColor) : null);
                cols.push(leaf.stroked ? colorObj(leaf.strokeColor) : null);
                tr = joinT(tr, transpOf(compound || leaf));
            }
        } else if (leaf.typename === 'TextFrame') {
            cols.push(safe(function () { return colorObj(leaf.textRange.characterAttributes.fillColor); }, null));
            tr = joinT(tr, transpOf(leaf));
        }
    });
    return { pts: pts, cols: cols, nPts: nPts, transp: tr };
}

/* Copie temporaire « réelle » (symbole détaché, textes vectorisés) pour lire la géométrie
 * Temporary real copy (symbol link broken, texts outlined) to read the geometry.
 * fn(copie, signatureAvantVectorisation) */
function withRealArt(item, tmpLayer, fn) {
    var dup, res = null, sig;
    try {
        dup = item.duplicate(tmpLayer, ElementPlacement.PLACEATBEGINNING);
        if (dup.typename === 'SymbolItem') { dup.breakLink(); dup = tmpLayer.pageItems[0]; }
        sig = tokenOf(dup);
        outlineTexts(dup);
        dup = tmpLayer.pageItems[0];
        res = fn(dup, sig);
    } catch (e) { res = null; }
    try { while (tmpLayer.pageItems.length) { tmpLayer.pageItems[0].remove(); } } catch (e2) {}
    return res;
}
function outlineTexts(item) {
    var i, list = [];
    if (item.typename === 'TextFrame') { item.createOutline(); return; }
    if (item.typename !== 'GroupItem') { return; }
    for (i = 0; i < item.pageItems.length; i++) { list.push(item.pageItems[i]); }
    for (i = 0; i < list.length; i++) {
        if (list[i].typename === 'TextFrame') { list[i].createOutline(); }
        else if (list[i].typename === 'GroupItem') { outlineTexts(list[i]); }
        else if (list[i].typename === 'SymbolItem') { try { list[i].breakLink(); } catch (e) {} }
    }
}

/* Quatre points d'une image liée / incorporée d'après sa matrice */
function matrixPts(item) {
    var m = item.matrix, P = [[0, 0], [100, 0], [100, 100], [0, 100]], out = [], i;
    for (i = 0; i < 4; i++) { out.push([m.mValueA * P[i][0] + m.mValueC * P[i][1] + m.mValueTX, m.mValueB * P[i][0] + m.mValueD * P[i][1] + m.mValueTY]); }
    return out;
}

function boundsOf(item) { return safe(function () { var g = item.geometricBounds; return [g[0], g[1], g[2], g[3]]; }, null); }

/* Description de la référence / reference description */
function buildRef(item, tmpLayer) {
    var t = item.typename, ref = { item: item, typename: t, sig: tokenOf(item), sigs: [], bounds: boundsOf(item), itemBounds: boundsOf(item) };
    if (t !== 'GroupItem' && t !== 'PathItem' && t !== 'CompoundPathItem' && t !== 'SymbolItem' && t !== 'PlacedItem' && t !== 'RasterItem' && t !== 'TextFrame') {
        ref.error = t; return ref;
    }
    ref.sigs.push(ref.sig);
    if (t === 'PlacedItem' || t === 'RasterItem') {
        ref.kind = 'image'; ref.fileName = t === 'PlacedItem' ? fileNameOf(item) : '';
        ref.pts = matrixPts(item); ref.cols = []; ref.nPts = 4;
        return ref;
    }
    ref.kind = t === 'SymbolItem' ? 'symbol' : 'art';
    if (t === 'SymbolItem') { ref.symbolName = safe(function () { return item.symbol.name; }, '?'); }
    var g;
    if (needsRealArt(ref.sig)) {
        g = withRealArt(item, tmpLayer, function (d, sigBefore) {
            var r = artGeometry(d); r.sigBefore = sigBefore; r.bounds = boundsOf(d); return r;
        });
        if (g && t === 'SymbolItem' && g.sigBefore !== ref.sig) { ref.sigs.push(g.sigBefore); } // copies au lien rompu / broken-link copies
    } else { g = artGeometry(item); g.bounds = ref.bounds; }
    if (!g || g.pts.length < 3) { ref.error = t; return ref; }
    ref.pts = g.pts; ref.cols = g.cols; ref.nPts = g.nPts;
    if (g.bounds) { ref.bounds = g.bounds; }
    return ref;
}

function sigMatches(ref, item, sig) {
    var i;
    if (ref.kind === 'image') {
        if (item.typename === 'PlacedItem' && ref.typename === 'PlacedItem') { return fileNameOf(item) === ref.fileName; }
        if (item.typename === 'RasterItem' && ref.typename === 'RasterItem') { return sameBounds(boundsOf(item), ref.itemBounds); }
        return false;
    }
    for (i = 0; i < ref.sigs.length; i++) { if (sig === ref.sigs[i]) { return true; } }
    return false;
}
function sameBounds(a, b) {
    if (!a || !b) { return false; }
    return Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01 && Math.abs(a[2] - b[2]) < 0.01 && Math.abs(a[3] - b[3]) < 0.01;
}

function isMarkLayer(layer) { return layer.name === MARK_LAYER_FR || layer.name === MARK_LAYER_EN || layer.name === TMP_LAYER; }

/* Parcours unique du document : copies du logo + obstacles (feuilles visibles)
 * Single pass over the document: logo copies + obstacles (visible leaves) */
function scanDocument(doc, ref) {
    var ctx = { logos: [], obstacles: [] }, i;
    function clipOfGroup(g) {
        var j, it;
        if (!g.clipped) { return null; }
        for (j = 0; j < g.pageItems.length; j++) {
            it = g.pageItems[j];
            if ((it.typename === 'PathItem' && it.clipping) || (it.typename === 'CompoundPathItem' && it.pathItems.length && it.pathItems[0].clipping)) { return boundsOf(it); }
        }
        return null;
    }
    // retourne {sig, obs} ; obs = obstacles du sous-arbre (vide si c'est un logo)
    function visit(item, clip, tp) {
        var t = item.typename, sig, obs = [], j, r, parts, op;
        if (item.hidden) { return { sig: '', obs: [] }; }
        op = joinT(tp, transpOf(item));
        if (t === 'GroupItem') {
            var c2 = clip, gc = clipOfGroup(item);
            if (gc) { c2 = CL.rectIntersection(clip, gc); }
            parts = [];
            for (j = 0; j < item.pageItems.length; j++) {
                r = visit(item.pageItems[j], c2, op);
                if (r.sig !== '') { parts.push(r.sig); }
                obs = obs.concat(r.obs);
            }
            sig = 'G(' + parts.join(',') + ')';
        } else {
            sig = tokenOf(item);
            var k = t === 'TextFrame' ? 'text' : ((t === 'PlacedItem' || t === 'RasterItem') ? 'image' : (t === 'SymbolItem' ? 'symbol' : ((t === 'PathItem' || t === 'CompoundPathItem') ? 'shape' : 'other')));
            if (!(t === 'PathItem' && (item.guides || item.clipping))) { obs.push({ item: item, kind: k, clip: clip, bounds: boundsOf(item) }); }
        }
        if (sigMatches(ref, item, sig)) {
            ctx.logos.push({ item: item, sig: sig, clip: clip, transp: tp, ownTransp: transpOf(item) });
            return { sig: sig, obs: [] };
        }
        return { sig: sig, obs: obs };
    }
    function visitLayer(layer, tp) {
        var j, r, op;
        if (!layer.visible || isMarkLayer(layer)) { return; }
        op = joinT(tp, safe(function () { return layer.opacity < 99.5 ? CL.fmt(layer.opacity, 0) + ' %' : ''; }, ''));
        for (j = 0; j < layer.pageItems.length; j++) {
            r = visit(layer.pageItems[j], null, op);
            ctx.obstacles = ctx.obstacles.concat(r.obs);
        }
        for (j = 0; j < layer.layers.length; j++) { visitLayer(layer.layers[j], op); }
    }
    for (i = 0; i < doc.layers.length; i++) { visitLayer(doc.layers[i], ''); }
    return ctx;
}

/* Géométrie d'un obstacle (lue seulement s'il touche la zone) / obstacle geometry (lazy) */
function obstaclePolys(o, step, tmpLayer) {
    var polys = [], filled = true, it = o.item, t = it.typename, i;
    function addPath(p) {
        if (p.guides || p.clipping) { return; }
        polys.push({ pts: CL.flatten(pathData(p), p.closed, step), closed: p.closed });
    }
    if (t === 'PathItem') {
        addPath(it);
        filled = it.filled && it.closed && safe(function () { return it.fillColor.typename !== 'NoColor'; }, true);
    } else if (t === 'CompoundPathItem') {
        for (i = 0; i < it.pathItems.length; i++) { addPath(it.pathItems[i]); }
        filled = it.pathItems.length > 0 && it.pathItems[0].filled;
    } else if (t === 'TextFrame') {
        safe(function () {
            var d = it.duplicate(tmpLayer, ElementPlacement.PLACEATBEGINNING);
            d.createOutline();
            eachLeaf(tmpLayer.pageItems[0], function (leaf) { if (leaf.typename === 'PathItem') { addPath(leaf); } });
            return true;
        }, false);
        safe(function () { while (tmpLayer.pageItems.length) { tmpLayer.pageItems[0].remove(); } return true; }, false);
        filled = true;
        if (!polys.length && o.bounds) { polys.push({ pts: CL.rectQuad(o.bounds), closed: true }); }
    } else {
        if (o.bounds) { polys.push({ pts: CL.rectQuad(o.bounds), closed: true }); }
        filled = true;
    }
    return { polys: polys, filled: filled };
}

function artboardFor(doc, pt) {
    var i, r;
    for (i = 0; i < doc.artboards.length; i++) {
        r = doc.artboards[i].artboardRect;
        if (CL.inRect(pt, r, 0)) { return { index: i, rect: [r[0], r[1], r[2], r[3]], name: doc.artboards[i].name }; }
    }
    return null;
}

/* Analyse complète / full analysis */
function analyse(doc, ref, rules, tmpLayer) {
    var ctx = scanDocument(doc, ref), results = [], i, j, skipped = 0, unread = 0;
    var refRect = ref.bounds, refW = refRect[2] - refRect[0], refH = refRect[1] - refRect[3];
    var refIdx = CL.sampleIdx(ref.pts.length, 800), P = [];
    for (i = 0; i < refIdx.length; i++) { P.push(ref.pts[refIdx[i]]); }
    for (i = 0; i < ctx.logos.length; i++) {
        var lg = ctx.logos[i], it = lg.item, g, Q = [], T = null, rms = null;
        if (ref.kind === 'image') {
            T = CL.fitAffine(ref.pts, matrixPts(it));
            if (T) {
                var cb = boundsOf(it), cxC = (cb[0] + cb[2]) / 2, cyC = (cb[1] + cb[3]) / 2;
                var cxR = (refRect[0] + refRect[2]) / 2, cyR = (refRect[1] + refRect[3]) / 2;
                T.e = cxC - (T.a * cxR + T.b * cyR); T.f = cyC - (T.c * cxR + T.d * cyR);
            }
            g = { cols: [], transp: '' };
        } else {
            if (needsRealArt(lg.sig) || it.typename === 'SymbolItem') { g = withRealArt(it, tmpLayer, function (d) { return artGeometry(d); }); }
            else { g = artGeometry(it); }
            if (!g || g.pts.length !== ref.pts.length) { unread++; continue; }
            for (j = 0; j < refIdx.length; j++) { Q.push(g.pts[refIdx[j]]); }
            T = CL.fitAffine(P, Q); rms = T ? T.rms : null;
        }
        if (!T) { unread++; continue; }
        lg.T = T; lg.cols = g.cols; lg.rms = rms;
        lg.opacity = joinT(lg.transp, joinT(lg.ownTransp, g.transp));
        lg.centre = CL.applyT(T, (refRect[0] + refRect[2]) / 2, (refRect[1] + refRect[3]) / 2);
        lg.artboard = artboardFor(doc, lg.centre);
        lg.isRef = sameBounds(boundsOf(it), ref.itemBounds) || safe(function () { return String(it.note).indexOf(REF_TAG) >= 0; }, false);
        if (!lg.artboard && rules.skipPasteboard) { skipped++; continue; }
        results.push(lg);
    }
    for (i = 0; i < results.length; i++) {
        var c = results[i];
        var cand = { T: c.T, refRect: refRect, refW: refW, refH: refH, artRect: c.artboard ? c.artboard.rect : null,
                     maskRect: c.clip, opacityIssue: c.opacity, cols: c.cols, refCols: ref.cols, shapeRms: c.rms, obstacles: [], otherLogos: [] };
        var pre = CL.evaluate({ T: c.T, refRect: refRect, refW: refW, refH: refH }, { minSize: 0, distTol: 1e9, skewTol: 1e9, rotPolicy: 'any', xBase: rules.xBase, xFactor: rules.xFactor, xFixedMm: rules.xFixedMm }, L);
        var zb = CL.polyBounds(pre.zoneQuad), step = Math.max(0.25, pre.X / 6);
        for (j = 0; j < ctx.obstacles.length; j++) {
            var o = ctx.obstacles[j];
            if (!o.bounds || !CL.rectsIntersect(o.bounds, zb)) { continue; }
            if (o.clip && (o.clip[4] || !CL.rectsIntersect(o.clip, zb))) { continue; }
            var geo = obstaclePolys(o, step, tmpLayer);
            var res = CL.analyseObstacle(geo.polys, pre.zoneQuad, pre.logoQuad, o.clip, geo.filled, c.centre);
            if (res.kind === 'intrusion' || res.kind === 'backgroundEdge') {
                cand.obstacles.push({ label: L(o.kind === 'text' ? 'kText' : (o.kind === 'image' ? 'kImage' : (o.kind === 'shape' ? 'kShape' : (o.kind === 'symbol' ? 'kSymbol' : 'kOther')))), res: res, item: o.item });
            }
        }
        for (j = 0; j < results.length; j++) {
            if (j === i) { continue; }
            var oq = CL.rectQuad(refRect, results[j].T);
            if (CL.rectsIntersect(CL.polyBounds(oq), zb)) { cand.otherLogos.push(oq); }
        }
        c.ev = CL.evaluate(cand, rules, L);
        c.obstacles = cand.obstacles;
    }
    return { results: results, skipped: skipped, unread: unread, total: ctx.logos.length };
}

/* ---------------------------------------------------------------------------
 * Repères, rapport / markers, report
 * ------------------------------------------------------------------------- */
function mkColor(doc, r, g, b) {
    if (doc.documentColorSpace === DocumentColorSpace.CMYK) {
        var c = new CMYKColor(), k = Math.min(1 - r / 255, 1 - g / 255, 1 - b / 255);
        c.black = k * 100;
        c.cyan = k >= 1 ? 0 : (1 - r / 255 - k) / (1 - k) * 100;
        c.magenta = k >= 1 ? 0 : (1 - g / 255 - k) / (1 - k) * 100;
        c.yellow = k >= 1 ? 0 : (1 - b / 255 - k) / (1 - k) * 100;
        return c;
    }
    var x = new RGBColor(); x.red = r; x.green = g; x.blue = b; return x;
}
function getMarkLayer(doc, create) {
    var i;
    for (i = 0; i < doc.layers.length; i++) { if (isMarkLayer(doc.layers[i]) && doc.layers[i].name !== TMP_LAYER) { return doc.layers[i]; } }
    if (!create) { return null; }
    var l = doc.layers.add(); l.name = L('layerName'); l.printable = false;
    try { l.zOrder(ZOrderMethod.BRINGTOFRONT); } catch (e) {}
    return l;
}
function clearMarkers(doc) {
    var l = getMarkLayer(doc, false), guard = 0;
    while (l && guard++ < 20) { l.locked = false; l.remove(); l = getMarkLayer(doc, false); }
}
function drawPoly(layer, pts, color, width, dashed) {
    var p = layer.pathItems.add();
    p.setEntirePath(pts); p.closed = true; p.filled = false; p.stroked = true;
    p.strokeColor = color; p.strokeWidth = width;
    if (dashed) { p.strokeDashes = [width * 4, width * 3]; }
    return p;
}
function drawMarkers(doc, data) {
    clearMarkers(doc);
    var layer = getMarkLayer(doc, true), i, j, k, c;
    var red = mkColor(doc, 230, 0, 30), orange = mkColor(doc, 255, 140, 0), green = mkColor(doc, 0, 170, 80);
    for (i = 0; i < data.results.length; i++) {
        c = data.results[i];
        var col = c.ev.severity === 2 ? red : (c.ev.severity === 1 ? orange : green);
        var size = Math.max(c.ev.w, c.ev.h), lw = Math.max(0.25, Math.min(2, size / 150));
        drawPoly(layer, c.ev.logoQuad, col, lw, false);
        drawPoly(layer, c.ev.zoneQuad, col, lw, true);
        for (j = 0; j < c.obstacles.length; j++) {
            var r = c.obstacles[j].res;
            if (r.kind !== 'intrusion' || !r.points.length) { continue; }
            drawPoly(layer, CL.rectQuad(CL.expandRect(CL.polyBounds(r.points), lw)), red, lw / 2, false);
            var stepK = Math.max(1, Math.floor(r.points.length / 12));
            for (k = 0; k < r.points.length; k += stepK) {
                var dot = layer.pathItems.ellipse(r.points[k][1] + lw * 1.5, r.points[k][0] - lw * 1.5, lw * 3, lw * 3);
                dot.stroked = false; dot.filled = true; dot.fillColor = red;
            }
        }
        var lines = [L('logoN', i + 1) + (c.isRef ? ' · ' + L('refLabel') : '') + (c.ev.issues.length ? '' : ' — ' + L('ok'))];
        for (j = 0; j < c.ev.issues.length; j++) { lines.push('• ' + c.ev.issues[j].text); }
        var tf = layer.textFrames.add();
        tf.contents = lines.join('\r');
        safe(function () {
            tf.textRange.characterAttributes.size = Math.max(5, Math.min(14, size / 12));
            tf.textRange.characterAttributes.fillColor = col;
            return true;
        }, false);
        var zb = CL.polyBounds(c.ev.zoneQuad);
        tf.position = [zb[0], zb[3] - 2];
    }
    return layer;
}
function countSev(data, sev) { var n = 0, i; for (i = 0; i < data.results.length; i++) { if (data.results[i].ev.severity === sev) { n++; } } return n; }
function summaryText(data) {
    var s = L('summary').replace('%1', data.results.length).replace('%2', countSev(data, 0)).replace('%3', countSev(data, 1)).replace('%4', countSev(data, 2));
    if (data.skipped) { s += '\n' + L('skipped').replace('%1', data.skipped); }
    if (data.unread) { s += '\n' + L('unread').replace('%1', data.unread); }
    return s;
}
function logoLine(c, i) {
    var d = c.ev.dec, fr = CLUI.fr;
    return L('logoN', i + 1) + (c.isRef ? ' (' + L('refLabel') + ')' : '') + ' — ' + (c.artboard ? L('onAb', c.artboard.name) : L('pasteboard')) + ' — ' +
        L('sizeInfo').replace('%1', CL.fmt(c.ev.w / CL.PT_PER_MM, 1, fr)).replace('%2', CL.fmt(c.ev.h / CL.PT_PER_MM, 1, fr)).replace('%3', CL.fmt(d.scale * 100, 0, fr)) +
        (!d.flip && CL.angleOff(d.rotation, 360) > 0.05 ? ', ' + CL.fmt(d.rotation, 1, fr) + '°' : '');
}
function reportText(doc, data) {
    var out = [], i, j, c;
    out.push(L('reportHead') + ' — ' + doc.name + ' — ' + new Date().toString());
    out.push(summaryText(data));
    out.push('');
    for (i = 0; i < data.results.length; i++) {
        c = data.results[i];
        out.push(logoLine(c, i));
        if (!c.ev.issues.length) { out.push('   OK  ' + L('ok')); }
        for (j = 0; j < c.ev.issues.length; j++) { out.push('   ' + (c.ev.issues[j].sev === 2 ? 'X   ' : '!   ') + c.ev.issues[j].text); }
    }
    return out.join('\n');
}

/* ---------------------------------------------------------------------------
 * Réglages mémorisés (fichier local) / remembered settings (local file)
 * ------------------------------------------------------------------------- */
var DEFAULTS = { minSize: '20', minUnit: 'mm', minDim: 0, xFactor: '0,5', xBase: 0, xFixedMm: '5', edge: true, skipPaste: true,
                 distTol: '1', skewTol: '0,5', rotPolicy: 0, colors: true, cOrig: true, cBlack: true, cWhite: true, cMono: false,
                 opac: true, crop: true, shapeTol: '2', markers: true, selectBad: true, report: false };
function prefsFile() { return new File(Folder.userData + '/ConformiteLogo.prefs'); }
function loadPrefs() {
    var p = {}, k, f = prefsFile(), line, m, d;
    for (k in DEFAULTS) { if (DEFAULTS.hasOwnProperty(k)) { p[k] = DEFAULTS[k]; } }
    try {
        f.encoding = 'UTF-8';
        if (f.exists && f.open('r')) {
            while (!f.eof) {
                line = f.readln(); m = line.match(/^(\w+)=(.*)$/);
                if (m && DEFAULTS.hasOwnProperty(m[1])) {
                    d = DEFAULTS[m[1]];
                    p[m[1]] = typeof d === 'boolean' ? m[2] === 'true' : (typeof d === 'number' ? (parseInt(m[2], 10) || 0) : m[2]);
                }
            }
            f.close();
        }
    } catch (e) {}
    return p;
}
function savePrefs(p) {
    var f = prefsFile(), k;
    try { f.encoding = 'UTF-8'; if (f.open('w')) { for (k in p) { if (p.hasOwnProperty(k)) { f.writeln(k + '=' + p[k]); } } f.close(); } } catch (e) {}
}

/* Référence mémorisée dans la note d'un objet / reference remembered in an object note */
function findStoredRef(doc) {
    var i, it, n = doc.pageItems.length;
    for (i = 0; i < n; i++) {
        it = doc.pageItems[i];
        if (safe(function () { return String(it.note).indexOf(REF_TAG) >= 0; }, false)) { return it; }
    }
    return null;
}

/* ---------------------------------------------------------------------------
 * Fenêtre / dialog (ScriptUI)
 * ------------------------------------------------------------------------- */
function showDialog(ref, stored, prefs) {
    var w = new Window('dialog', L('title') + ' — ConformiteLogo 1.0.0'), fr = CLUI.fr;
    w.orientation = 'column'; w.alignChildren = ['fill', 'top'];
    var pR = w.add('panel', undefined, L('refPanel')); pR.alignChildren = ['left', 'top'];
    var typeTxt = ref.kind === 'symbol' ? L('typeSymbol').replace('%1', ref.symbolName) :
        (ref.kind === 'image' ? (ref.typename === 'PlacedItem' ? L('typePlaced').replace('%1', ref.fileName) : L('typeRaster')) : L('typeArt'));
    var rw = (ref.bounds[2] - ref.bounds[0]) / CL.PT_PER_MM, rh = (ref.bounds[1] - ref.bounds[3]) / CL.PT_PER_MM;
    pR.add('statictext', undefined, L('refDesc').replace('%1', typeTxt).replace('%2', CL.fmt(rw, 1, fr)).replace('%3', CL.fmt(rh, 1, fr)).replace('%4', ref.nPts) + (stored ? L('refStored') : ''));
    if (ref.kind !== 'image' && ref.nPts < 12) { pR.add('statictext', undefined, L('weakRef')); }
    var cbRem = pR.add('checkbox', undefined, L('remember')); cbRem.value = stored;

    var pS = w.add('panel', undefined, L('rules')); pS.alignChildren = ['left', 'top'];
    var g1 = pS.add('group'); g1.add('statictext', undefined, L('minSize'));
    var eMin = g1.add('edittext', undefined, prefs.minSize); eMin.characters = 6;
    var ddU = g1.add('dropdownlist', undefined, ['mm', 'px / pt']); ddU.selection = prefs.minUnit === 'mm' ? 0 : 1;
    g1.add('statictext', undefined, L('ofDim'));
    var ddD = g1.add('dropdownlist', undefined, L('dims')); ddD.selection = prefs.minDim;
    var g2 = pS.add('group'); g2.add('statictext', undefined, L('zone'));
    var eX = g2.add('edittext', undefined, prefs.xFactor); eX.characters = 5;
    g2.add('statictext', undefined, L('times'));
    var ddB = g2.add('dropdownlist', undefined, L('bases')); ddB.selection = prefs.xBase;
    var g2b = pS.add('group'); g2b.add('statictext', undefined, L('fixedMm'));
    var eFix = g2b.add('edittext', undefined, prefs.xFixedMm); eFix.characters = 6;
    function syncFix() { eFix.enabled = ddB.selection.index === 3; eX.enabled = ddB.selection.index !== 3; }
    ddB.onChange = syncFix; syncFix();
    var cbEdge = pS.add('checkbox', undefined, L('edgeObs')); cbEdge.value = prefs.edge;
    var cbPaste = pS.add('checkbox', undefined, L('skipPaste')); cbPaste.value = prefs.skipPaste;

    var pC = w.add('panel', undefined, L('checks')); pC.alignChildren = ['left', 'top'];
    var g3 = pC.add('group'); g3.add('statictext', undefined, L('distort'));
    var eDist = g3.add('edittext', undefined, prefs.distTol); eDist.characters = 4;
    g3.add('statictext', undefined, L('skewTol'));
    var eSkew = g3.add('edittext', undefined, prefs.skewTol); eSkew.characters = 4;
    var g4 = pC.add('group'); g4.add('statictext', undefined, L('rot'));
    var ddR = g4.add('dropdownlist', undefined, L('rots')); ddR.selection = prefs.rotPolicy;
    var cbCol = pC.add('checkbox', undefined, L('colors')); cbCol.value = prefs.colors;
    var g5 = pC.add('group'); g5.margins = [18, 0, 0, 0];
    var cbO = g5.add('checkbox', undefined, L('cOrig')); cbO.value = prefs.cOrig;
    var cbB = g5.add('checkbox', undefined, L('cBlack')); cbB.value = prefs.cBlack;
    var cbW = g5.add('checkbox', undefined, L('cWhite')); cbW.value = prefs.cWhite;
    var cbM = g5.add('checkbox', undefined, L('cMono')); cbM.value = prefs.cMono;
    cbCol.onClick = function () { g5.enabled = cbCol.value; }; g5.enabled = cbCol.value;
    if (ref.kind === 'image') { cbCol.value = false; cbCol.enabled = false; g5.enabled = false; }
    var cbOp = pC.add('checkbox', undefined, L('opac')); cbOp.value = prefs.opac;
    var cbCr = pC.add('checkbox', undefined, L('crop')); cbCr.value = prefs.crop;
    var g6 = pC.add('group'); g6.add('statictext', undefined, L('shape'));
    var eShape = g6.add('edittext', undefined, prefs.shapeTol); eShape.characters = 4;

    var pO = w.add('panel', undefined, L('output')); pO.alignChildren = ['left', 'top'];
    var cbMk = pO.add('checkbox', undefined, L('markers')); cbMk.value = prefs.markers;
    var cbSel = pO.add('checkbox', undefined, L('selectBad')); cbSel.value = prefs.selectBad;
    var cbRep = pO.add('checkbox', undefined, L('report')); cbRep.value = prefs.report;
    var tip = w.add('statictext', undefined, L('tipCopy'), { multiline: true }); tip.preferredSize = [480, 34];

    var gb = w.add('group'); gb.alignment = ['right', 'top'];
    var bClear = gb.add('button', undefined, L('clear'));
    var bAn = gb.add('button', undefined, L('analyse'));
    var bCancel = gb.add('button', undefined, L('cancel'), { name: 'cancel' });
    var bRun = gb.add('button', undefined, L('run'), { name: 'ok' });
    var result = null;

    function collect() {
        var vals = [eMin, eX, eFix, eDist, eSkew, eShape], i, v;
        for (i = 0; i < vals.length; i++) {
            v = CL.parseNum(vals[i].text);
            if (v === null || v < 0) { alert(L('badNum') + vals[i].text, L('title')); return null; }
        }
        var p = { minSize: eMin.text, minUnit: ddU.selection.index === 0 ? 'mm' : 'pt', minDim: ddD.selection.index, xFactor: eX.text, xBase: ddB.selection.index,
                  xFixedMm: eFix.text, edge: cbEdge.value, skipPaste: cbPaste.value, distTol: eDist.text, skewTol: eSkew.text, rotPolicy: ddR.selection.index,
                  colors: cbCol.value, cOrig: cbO.value, cBlack: cbB.value, cWhite: cbW.value, cMono: cbM.value, opac: cbOp.value, crop: cbCr.value,
                  shapeTol: eShape.text, markers: cbMk.value, selectBad: cbSel.value, report: cbRep.value };
        return { prefs: p, rules: rulesFromPrefs(p, ref), remember: cbRem.value };
    }
    bAn.onClick = function () { var r = collect(); if (r) { r.mode = 'analyse'; result = r; w.close(1); } };
    bRun.onClick = function () { var r = collect(); if (r) { r.mode = 'run'; result = r; w.close(1); } };
    bClear.onClick = function () { result = { mode: 'clear' }; w.close(1); };
    bCancel.onClick = function () { result = null; w.close(0); };
    w.show();
    return result;
}
function rulesFromPrefs(p, ref) {
    return { minSize: CL.parseNum(p.minSize), minUnit: p.minUnit, minDim: ['width', 'height', 'min'][p.minDim], xFactor: CL.parseNum(p.xFactor),
             xBase: ['height', 'width', 'min', 'fixed'][p.xBase], xFixedMm: CL.parseNum(p.xFixedMm), distTol: CL.parseNum(p.distTol), skewTol: CL.parseNum(p.skewTol),
             rotPolicy: ['any', 'right', 'none'][p.rotPolicy], checkColors: p.colors && ref.kind !== 'image', allowOriginal: p.cOrig, allowBlack: p.cBlack,
             allowWhite: p.cWhite, allowMono: p.cMono, edgeIsObstacle: p.edge, skipPasteboard: p.skipPaste, checkOpacity: p.opac, checkCrop: p.crop,
             shapeTol: ref.kind === 'image' ? 0 : CL.parseNum(p.shapeTol) };
}

/* ---------------------------------------------------------------------------
 * Programme principal / main
 * ------------------------------------------------------------------------- */
function withTmpLayer(doc, fn) {
    var tmp = doc.layers.add(), res;
    tmp.name = TMP_LAYER;
    try { res = fn(tmp); } finally { safe(function () { tmp.remove(); return true; }, false); }
    return res;
}
function main(uiOverride) {
    if (app.documents.length === 0) { alert(L('noDoc'), L('title')); return null; }
    var doc = app.activeDocument, sel = doc.selection, refItem = null, stored = false;
    if (sel && sel.length > 1) { alert(L('oneRef'), L('title')); return null; }
    if (sel && sel.length === 1 && sel[0].typename) { refItem = sel[0]; }
    if (!refItem) { refItem = findStoredRef(doc); stored = !!refItem; }
    else { stored = safe(function () { return String(refItem.note).indexOf(REF_TAG) >= 0; }, false); }
    if (!refItem) {
        if (getMarkLayer(doc, false)) { if (confirm(L('clearAsk'))) { clearMarkers(doc); } }
        else { alert(L('noRef'), L('title')); }
        return null;
    }
    var ref = withTmpLayer(doc, function (tmp) { return buildRef(refItem, tmp); });
    if (ref.error) { alert(L('badRef') + ref.error, L('title')); return null; }
    var ui = uiOverride ? uiOverride(ref, stored, loadPrefs()) : showDialog(ref, stored, loadPrefs());
    if (!ui) { return null; }
    if (ui.mode === 'clear') { clearMarkers(doc); alert(L('cleared'), L('title')); return ui; }
    savePrefs(ui.prefs);
    if (ui.mode === 'run') {
        safe(function () {
            var n = String(refItem.note || '');
            if (ui.remember && n.indexOf(REF_TAG) < 0) { refItem.note = (n ? n + ' ' : '') + REF_TAG; }
            if (!ui.remember && n.indexOf(REF_TAG) >= 0) { refItem.note = n.replace(REF_TAG, '').replace(/^\s+|\s+$/g, ''); }
            return true;
        }, false);
    }
    var data = withTmpLayer(doc, function (tmp) { return analyse(doc, ref, ui.rules, tmp); });
    ui.data = data;
    if (!data.results.length) {
        alert(L('noneFound') + (data.skipped ? '\n' + L('skipped').replace('%1', data.skipped) : '') + (data.unread ? '\n' + L('unread').replace('%1', data.unread) : ''), L('title'));
        return ui;
    }
    var msg = summaryText(data), lines = [], i, j, shown = 0, c;
    for (i = 0; i < data.results.length; i++) {
        c = data.results[i];
        if (!c.ev.issues.length) { continue; }
        if (shown < 10) {
            lines.push(logoLine(c, i));
            for (j = 0; j < c.ev.issues.length; j++) { lines.push('   • ' + c.ev.issues[j].text); }
        }
        shown++;
    }
    if (shown > 10) { lines.push(L('more').replace('%1', shown - 10)); }
    if (ui.mode === 'run') {
        if (ui.prefs.markers) { drawMarkers(doc, data); }
        if (ui.prefs.selectBad) {
            doc.selection = null;
            for (i = 0; i < data.results.length; i++) {
                c = data.results[i];
                if (c.ev.severity > 0) { safe(function () { c.item.selected = true; return true; }, false); }
            }
        }
        if (ui.prefs.report) {
            var f = new File(Folder.desktop + '/' + String(doc.name).replace(/\.[^.]+$/, '') + '_conformite-logo.txt');
            f.encoding = 'UTF-8';
            if (f.open('w')) { f.write(reportText(doc, data)); f.close(); msg += '\n\n' + L('reportSaved') + decodeURI(f.fsName); }
        }
    } else { msg += '\n' + L('analyseOnly'); }
    alert(msg + (lines.length ? '\n\n' + lines.join('\n') : ''), L('title'));
    return ui;
}

if (typeof CL_TEST === 'undefined') {
    try { main(); } catch (e) { alert(L('error') + e + (e.line ? ' (ligne / line ' + e.line + ')' : ''), L('title')); }
}
