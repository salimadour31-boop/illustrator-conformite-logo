// Tests du moteur (hors Illustrator) / engine tests (outside Illustrator) — node tests/test-engine.js
var fs = require('fs'), path = require('path');
var src = fs.readFileSync(path.join(__dirname, '..', 'ConformiteLogo.jsx'), 'utf8');
var eng = src.slice(src.indexOf('//@@ENGINE_START'), src.indexOf('//@@ENGINE_END'));
var CL = new Function(eng + '\nreturn CL;')();
var pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; } else { fail++; console.log('ÉCHEC / FAIL: ' + m); } }
function near(a, b, t) { return Math.abs(a - b) <= (t || 1e-6); }
var seed = 12345; function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }

// 1. Ajustement affine + décomposition sur 500 transformations aléatoires
var P = [], i, k;
for (i = 0; i < 40; i++) { P.push([rnd() * 100, rnd() * 60]); }
var good = 0;
for (k = 0; k < 500; k++) {
    var th = (rnd() * 360 - 180) * Math.PI / 180, sx = 0.1 + rnd() * 3, sy = sx * (0.7 + rnd() * 0.6), sh = (rnd() - 0.5) * 0.4, flip = rnd() < 0.3 ? -1 : 1;
    // A = R(th) * [sx sh*sy; 0 flip*sy]
    var m11 = sx, m12 = sh * sy, m22 = flip * sy, co = Math.cos(th), si = Math.sin(th);
    var T = { a: co * m11, b: co * m12 - si * m22, c: si * m11, d: si * m12 + co * m22, e: rnd() * 500, f: rnd() * 500 };
    var Q = []; for (i = 0; i < P.length; i++) { Q.push(CL.applyT(T, P[i][0], P[i][1])); }
    var F = CL.fitAffine(P, Q), D = CL.decompose(F);
    var rotOk = near(CL.angleOff(D.rotation - th * 180 / Math.PI, 360), 0, 1e-6);
    if (near(F.a, T.a, 1e-6) && near(F.d, T.d, 1e-6) && near(F.e, T.e, 1e-5) && F.rms < 1e-6 && near(D.sx, sx, 1e-6) && near(Math.abs(D.sy), sy, 1e-6) &&
        D.flip === (flip < 0) && rotOk && near(D.distortion, sy / sx, 1e-6) && near(Math.tan(D.skew * Math.PI / 180), sh, 1e-6)) { good++; }
}
ok(good === 500, 'affine 500 aléatoires : ' + good);
ok(CL.fitAffine([[0, 0], [1, 1], [2, 2]], [[0, 0], [1, 1], [2, 2]]) === null, 'points alignés -> null');
ok(CL.fitAffine([[0, 0], [1, 0]], [[0, 0], [1, 0]]) === null, 'moins de 3 points -> null');
// bruit : rms > 0
var Qn = []; for (i = 0; i < P.length; i++) { Qn.push([P[i][0] + (rnd() - 0.5), P[i][1] + (rnd() - 0.5)]); }
var Fn = CL.fitAffine(P, Qn); ok(Fn.rms > 0.1 && Fn.rms < 0.5, 'rms avec bruit ' + Fn.rms);
// cas simples
var D1 = CL.decompose({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
ok(D1.rotation === 0 && !D1.flip && D1.distortion === 1 && D1.skew === 0 && D1.scale === 1, 'identité');
var D2 = CL.decompose({ a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 }); ok(D2.flip, 'miroir horizontal');
var D3 = CL.decompose({ a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 }); ok(D3.flip, 'miroir vertical');
var D4 = CL.decompose({ a: 0, b: -1, c: 1, d: 0, e: 0, f: 0 }); ok(near(D4.rotation, 90) && !D4.flip, 'rotation 90');
var D5 = CL.decompose({ a: 1.2, b: 0, c: 0, d: 1, e: 0, f: 0 }); ok(near(D5.distortion, 1 / 1.2), 'étirement horizontal 20 %');
ok(near(CL.angleOff(-90, 90), 0) && near(CL.angleOff(179.6, 90), 0.4, 1e-9) && near(CL.angleOff(-0.3, 360), 0.3, 1e-9), 'angleOff');

// 2. Géométrie de base
var sq = [[0, 10], [10, 10], [10, 0], [0, 0]];
ok(CL.pointInPoly([5, 5], sq) && !CL.pointInPoly([15, 5], sq), 'pointInPoly');
ok(CL.pointInPolys([5, 5], [{ pts: sq }, { pts: [[2, 8], [8, 8], [8, 2], [2, 2]] }]) === false, 'pair-impair : trou');
ok(near(CL.distPointQuad([15, 5], sq), 5) && CL.distPointQuad([5, 5], sq) === 0 && near(CL.distPointQuad([13, 14], sq), 5), 'distPointQuad');
ok(CL.segIntersect([0, 0], [10, 10], [0, 10], [10, 0])[0] === 5 && CL.segIntersect([0, 0], [1, 0], [0, 1], [1, 1]) === null, 'segIntersect');
var e1 = CL.rectIntersection([0, 10, 10, 0], [20, 30, 30, 20]); ok(e1[4] === true, 'intersection vide');
ok(CL.rectContainsRect([0, 10, 10, 0], [1, 9, 9, 1]) && !CL.rectContainsRect([0, 10, 10, 0], [1, 11, 9, 1]), 'rectContainsRect');
// cercle de Bézier : points sur le rayon (κ = 0.5523)
var kap = 0.5522847498 * 50, circ = [[50, 0, 50, -kap, 50, kap], [0, 50, kap, 50, -kap, 50], [-50, 0, -50, kap, -50, -kap], [0, -50, -kap, -50, kap, -50]];
var fl = CL.flatten(circ, true, 2), maxErr = 0;
for (i = 0; i < fl.length; i++) { maxErr = Math.max(maxErr, Math.abs(Math.sqrt(fl[i][0] * fl[i][0] + fl[i][1] * fl[i][1]) - 50)); }
ok(maxErr < 0.03 && fl.length > 100, 'aplatissement cercle err=' + maxErr + ' n=' + fl.length);
var line = CL.flatten([[0, 0, 0, 0, 0, 0], [100, 0, 100, 0, 100, 0]], false, 10); ok(line.length === 11 && line[10][0] === 100, 'segment droit densifié');
ok(CL.sampleIdx(10, 20).length === 10 && CL.sampleIdx(1000, 100).length === 100 && CL.sampleIdx(1000, 100)[99] === 990, 'échantillonnage');

// 3. Obstacles
var logo = [[0, 10], [10, 10], [10, 0], [0, 0]], zone = [[-5, 15], [15, 15], [15, -5], [-5, -5]], ctr = [5, 5];
function poly(l, t, r, b) { return { pts: [[l, t], [r, t], [r, b], [l, b]], closed: true }; }
var r1 = CL.analyseObstacle([poly(12, 3, 14, 1)], zone, logo, null, true, ctr); ok(r1.kind === 'intrusion' && near(r1.minDist, 2), 'intrusion à 2 pt');
var r2 = CL.analyseObstacle([poly(20, 30, 40, 20)], zone, logo, null, true, ctr); ok(r2.kind === 'none', 'objet loin');
var r3 = CL.analyseObstacle([poly(-100, 100, 100, -100)], zone, logo, null, true, ctr); ok(r3.kind === 'background', 'fond qui couvre tout');
var r4 = CL.analyseObstacle([poly(-100, 100, 100, -100)], zone, logo, null, false, ctr); ok(r4.kind === 'none', 'cadre au trait autour');
var r5 = CL.analyseObstacle([poly(-100, 100, 12, -100)], zone, logo, null, true, ctr); ok(r5.kind === 'backgroundEdge', 'bord de fond dans la zone');
var r6 = CL.analyseObstacle([poly(13, 100, 100, -100)], zone, logo, null, true, ctr); ok(r6.kind === 'intrusion' && near(r6.minDist, 3), 'fond voisin qui empiète');
var r7 = CL.analyseObstacle([{ pts: [[-20, 5], [30, 5]], closed: false }], zone, logo, null, false, ctr); ok(r7.kind === 'intrusion' && r7.minDist === 0, 'filet ouvert qui traverse');
var r8 = CL.analyseObstacle([poly(12, 3, 14, 1)], zone, logo, [20, 30, 30, 20], true, ctr); ok(r8.kind === 'none', 'obstacle masqué hors du masque');
var r9 = CL.analyseObstacle([poly(-100, 100, 100, -100)], zone, logo, [-100, 100, 12, -100], true, ctr); ok(r9.kind === 'backgroundEdge', 'fond rogné par un masque dans la zone');
var r10 = CL.analyseObstacle([poly(4, 6, 6, 4)], zone, logo, null, true, ctr); ok(r10.kind === 'intrusion' && r10.minDist === 0, 'objet posé sur le logo');
var r11 = CL.analyseObstacle([{ pts: [[-30, 20], [30, 20], [30, 18], [-30, 18]], closed: true }], zone, logo, null, true, ctr); ok(r11.kind === 'none', 'bandeau hors zone');
var r12 = CL.analyseObstacle([{ pts: [[-30, 14], [30, 14], [30, 13.5], [-30, 13.5]], closed: true }], zone, logo, null, true, ctr); ok(r12.kind === 'intrusion' && near(r12.minDist, 3.5), 'bandeau sans sommet dans la zone');

// 4. Couleurs
var cK = { t: 'c', v: [0, 0, 0, 100] }, cW = { t: 'c', v: [0, 0, 0, 0] }, cR = { t: 'c', v: [0, 100, 100, 0] }, cB = { t: 'c', v: [100, 60, 0, 10] };
ok(CL.sameColor(cR, { t: 'c', v: [0.5, 99.5, 100, 0] }, 1.5) && !CL.sameColor(cR, cB, 1.5) && CL.sameColor(null, null) && !CL.sameColor(cR, null), 'sameColor');
ok(CL.sameColor({ t: 's', n: 'PANTONE 186 C', v: [100] }, { t: 's', n: 'PANTONE 186 C', v: [100] }, 1) && !CL.sameColor({ t: 's', n: 'A', v: [100] }, { t: 's', n: 'A', v: [50] }, 1), 'tons directs');
ok(CL.colorClass(cK) === 'black' && CL.colorClass({ t: 'c', v: [60, 40, 40, 100] }) === 'black' && CL.colorClass(cW) === 'white' && CL.colorClass({ t: 'r', v: [255, 255, 255] }) === 'white' &&
   CL.colorClass({ t: 'g', v: [100] }) === 'black' && CL.colorClass({ t: 's', n: 'Noir', v: [100] }) === 'black' && CL.colorClass(cR) === 'other', 'colorClass');
var ref = [cR, null, cB, null, cK, null];
ok(CL.colorVersion(ref, [cR, null, cB, null, cK, null], 1.5).version === 'original', 'version originale');
ok(CL.colorVersion(ref, [cK, null, cK, null, cK, null], 1.5).version === 'black', 'version noire');
ok(CL.colorVersion(ref, [cW, null, cW, null, cW, null], 1.5).version === 'white', 'version blanche');
var vm = CL.colorVersion(ref, [cB, null, cB, null, cB, null], 1.5); ok(vm.version === 'mono' && vm.diffs === 2, 'monochrome');
var vo = CL.colorVersion(ref, [cB, null, cR, null, cK, null], 1.5); ok(vo.version === 'other' && vo.diffs === 2 && vo.count === 3, 'couleurs inversées');
ok(CL.colorLabel(cR) === 'C0 M100 J100 N0' && CL.colorLabel({ t: 's', n: 'P 186', v: [50] }) === 'P 186 50 %', 'libellés couleur');

// 5. Évaluation
var rules = { minSize: 20, minUnit: 'mm', minDim: 'width', xFactor: 0.5, xBase: 'height', xFixedMm: 5, distTol: 1, skewTol: 0.5, rotPolicy: 'any',
              checkColors: true, allowOriginal: true, allowBlack: true, allowWhite: true, allowMono: false, edgeIsObstacle: true, checkOpacity: true, checkCrop: true, shapeTol: 2 };
var mm = CL.PT_PER_MM, refRect = [0, 20 * mm, 40 * mm, 0]; // logo 40 × 20 mm
function cand(T, extra) { var c = { T: T, refRect: refRect, refW: 40 * mm, refH: 20 * mm, artRect: [-1000, 1000, 1000, -1000], cols: ref, refCols: ref, shapeRms: 0, obstacles: [], otherLogos: [] }; for (var k in extra) { c[k] = extra[k]; } return c; }
function codes(ev) { var s = []; for (var i = 0; i < ev.issues.length; i++) { s.push(ev.issues[i].code); } return s.join(','); }
var I = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
var Lf = function (k) { var a = []; for (var i = 1; i < arguments.length; i++) { a.push(typeof arguments[i] === 'number' ? CL.fmt(arguments[i], 2, true) : String(arguments[i])); } return k + ' ' + a.join(' '); };
var ev = CL.evaluate(cand(I), rules, Lf); ok(ev.issues.length === 0 && ev.severity === 0 && near(ev.X, 10 * mm, 1e-6), 'copie conforme, X = 10 mm');
ev = CL.evaluate(cand({ a: 0.4, b: 0, c: 0, d: 0.4, e: 0, f: 0 }), rules, Lf); ok(codes(ev) === 'size' && /16/.test(ev.issues[0].text), 'trop petit (16 mm) : ' + codes(ev));
ev = CL.evaluate(cand({ a: 1.2, b: 0, c: 0, d: 1, e: 0, f: 0 }), rules, Lf); ok(codes(ev) === 'distort', 'déformé');
ev = CL.evaluate(cand({ a: 1.005, b: 0, c: 0, d: 1, e: 0, f: 0 }), rules, Lf); ok(codes(ev) === '', 'déformation sous la tolérance');
ev = CL.evaluate(cand({ a: 1, b: 0.2, c: 0, d: 1, e: 0, f: 0 }), rules, Lf); ok(codes(ev) === 'skew', 'incliné : ' + codes(ev));
ev = CL.evaluate(cand({ a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 }), rules, Lf); ok(codes(ev) === 'flip', 'miroir');
var c30 = Math.cos(Math.PI / 6), s30 = Math.sin(Math.PI / 6), R30 = { a: c30, b: -s30, c: s30, d: c30, e: 0, f: 0 }, R90 = { a: 0, b: -1, c: 1, d: 0, e: 0, f: 0 };
ok(codes(CL.evaluate(cand(R30), rules, Lf)) === '', 'rotation autorisée');
rules.rotPolicy = 'right'; ev = CL.evaluate(cand(R30), rules, Lf); ok(codes(ev) === 'rotate' && ev.severity === 1, 'rotation 30° hors 0/90');
ok(codes(CL.evaluate(cand(R90), rules, Lf)) === '', 'rotation 90° permise');
rules.rotPolicy = 'none'; ok(codes(CL.evaluate(cand(R90), rules, Lf)) === 'rotate' && CL.evaluate(cand(R90), rules, Lf).severity === 2, 'rotation interdite'); rules.rotPolicy = 'any';
ok(codes(CL.evaluate(cand(I, { cols: [cB, null, cB, null, cB, null] }), rules, Lf)) === 'colors', 'monochrome refusé');
rules.allowMono = true; ok(codes(CL.evaluate(cand(I, { cols: [cB, null, cB, null, cB, null] }), rules, Lf)) === '', 'monochrome autorisé'); rules.allowMono = false;
ok(codes(CL.evaluate(cand(I, { cols: [cK, null, cK, null, cK, null] }), rules, Lf)) === '', 'noir autorisé');
rules.allowBlack = false; ok(codes(CL.evaluate(cand(I, { cols: [cK, null, cK, null, cK, null] }), rules, Lf)) === 'colors', 'noir refusé'); rules.allowBlack = true;
ok(codes(CL.evaluate(cand(I, { opacityIssue: '50 %' }), rules, Lf)) === 'opacity', 'opacité');
ok(codes(CL.evaluate(cand(I, { maskRect: [0, 20 * mm, 30 * mm, 0] }), rules, Lf)) === 'mask', 'rogné par masque');
ok(codes(CL.evaluate(cand(I, { maskRect: [-50, 200, 200, -50] }), rules, Lf)) === '', 'masque assez grand');
ok(codes(CL.evaluate(cand(I, { artRect: [10, 100, 1000, -1000] }), rules, Lf)) === 'edgeCut', 'coupé par le bord');
ev = CL.evaluate(cand(I, { artRect: [-5 * mm, 1000, 1000, -1000] }), rules, Lf); ok(codes(ev) === 'edge' && /0[,.]5/.test(ev.issues[0].text), 'trop près du bord (0,5 X) : ' + ev.issues[0].text);
rules.edgeIsObstacle = false; ok(codes(CL.evaluate(cand(I, { artRect: [-5 * mm, 1000, 1000, -1000] }), rules, Lf)) === '', 'bord non compté'); rules.edgeIsObstacle = true;
ev = CL.evaluate(cand(I, { shapeRms: 4 }), rules, Lf); ok(codes(ev) === 'shape' && ev.severity === 1, 'forme retouchée');
// zone : X fixe et autre logo
rules.xBase = 'fixed'; rules.xFixedMm = 5; ev = CL.evaluate(cand({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }), rules, Lf); ok(near(ev.X, 5 * mm, 1e-6), 'X fixe 5 mm même agrandi'); rules.xBase = 'height';
ev = CL.evaluate(cand(I, { otherLogos: [CL.rectQuad([42 * mm, 10 * mm, 60 * mm, 0])] }), rules, Lf); ok(codes(ev) === 'clear' && /0[,.]2/.test(ev.issues[0].text), 'autre logo à 2 mm = 0,2 X : ' + ev.issues[0].text);
// obstacle réel via analyseObstacle sur une copie agrandie et tournée
var T2 = { a: 2 * c30, b: -2 * s30, c: 2 * s30, d: 2 * c30, e: 300, f: 300 };
var pre = CL.evaluate(cand(T2), rules, Lf), cen = CL.applyT(T2, 20 * mm, 10 * mm);
var pt = CL.applyT(T2, 40 * mm + 5 * mm, 10 * mm); // à 5 mm × 2 = 10 mm du bord droit, X = 20 mm
var ob = CL.analyseObstacle([poly(pt[0] - 0.5, pt[1] + 0.5, pt[0] + 0.5, pt[1] - 0.5)], pre.zoneQuad, pre.logoQuad, null, true, cen);
ev = CL.evaluate(cand(T2, { obstacles: [{ label: 'texte', res: ob }] }), rules, Lf);
ok(codes(ev) === 'clear' && near(ob.minDist / ev.X, 0.5, 0.02), 'copie tournée : espace libre 0,5 X (' + (ob.minDist / ev.X) + ')');
ok(CL.parseNum('0,5') === 0.5 && CL.parseNum(' 12 ') === 12 && CL.parseNum('abc') === null && CL.fmt(1.25, 1, true) === '1,3', 'nombres');

console.log('Moteur / engine : ' + pass + ' réussis, ' + fail + ' échecs');
process.exit(fail ? 1 : 0);
