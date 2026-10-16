// Simulation du DOM d'Illustrator (objets factices) / simulated Illustrator DOM (mock objects)
// node tests/test-simulation.js — ne remplace pas un essai réel dans Illustrator.
var fs = require('fs'), path = require('path'), vm = require('vm');
var pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; } else { fail++; console.log('ÉCHEC / FAIL: ' + m); } }

// ---- objets factices / mocks ----
var alerts = [], confirms = [];
global.alert = function (m) { alerts.push(String(m)); };
global.confirm = function (m) { confirms.push(String(m)); return true; };
global.ElementPlacement = { PLACEATBEGINNING: 'begin' };
global.DocumentColorSpace = { CMYK: 'CMYK', RGB: 'RGB' };
global.ZOrderMethod = { BRINGTOFRONT: 'front' };
global.CMYKColor = function () { this.typename = 'CMYKColor'; this.cyan = 0; this.magenta = 0; this.yellow = 0; this.black = 0; };
global.RGBColor = function () { this.typename = 'RGBColor'; this.red = 0; this.green = 0; this.blue = 0; };
function cmyk(c, m, y, k) { var x = new CMYKColor(); x.cyan = c; x.magenta = m; x.yellow = y; x.black = k; return x; }
var files = {};
global.Folder = { userData: '/ud', desktop: '/desk' };
global.File = function (p) {
    this.fsName = p; this.encoding = '';
    var self = this, buf = '', lines = [], pos = 0, mode = '';
    Object.defineProperty(this, 'exists', { get: function () { return files.hasOwnProperty(p); } });
    Object.defineProperty(this, 'eof', { get: function () { return pos >= lines.length; } });
    this.open = function (m) { mode = m; if (m === 'r') { if (!files.hasOwnProperty(p)) { return false; } lines = files[p].split('\n'); if (lines[lines.length - 1] === '') { lines.pop(); } pos = 0; } else { buf = ''; } return true; };
    this.readln = function () { return lines[pos++]; };
    this.write = function (s) { buf += s; };
    this.writeln = function (s) { buf += s + '\n'; };
    this.close = function () { if (mode === 'w') { files[p] = buf; } };
};
global.decodeURI = decodeURI;

function Base(t) { this.typename = t; this.hidden = false; this.note = ''; this.opacity = 100; this.blendingMode = 'BlendModes.NORMAL'; this.locked = false; this.selected = false; this.parent = null; }
Base.prototype.remove = function () { var a = this.parent.pageItems, i = a.indexOf(this); if (i >= 0) { a.splice(i, 1); } this.parent = null; };
Base.prototype.duplicate = function (target, where) { var c = clone(this); c.selected = false; target.pageItems.unshift(c); c.parent = target; return c; };
function clone(it) {
    var c = Object.create(Object.getPrototypeOf(it)), k;
    for (k in it) { if (it.hasOwnProperty(k) && k !== 'parent' && k !== 'pageItems' && k !== 'pathItems' && k !== 'pathPoints') { c[k] = it[k]; } }
    if (it.pathPoints) { c.pathPoints = it.pathPoints.map(function (p) { return { anchor: p.anchor.slice(), leftDirection: p.leftDirection.slice(), rightDirection: p.rightDirection.slice() }; }); }
    if (it.typename === 'GroupItem') { c.pageItems = it.pageItems.map(function (ch) { var x = clone(ch); x.parent = c; return x; }); }
    if (it.typename === 'CompoundPathItem') { c.pathItems = it.pathItems.map(function (ch) { var x = clone(ch); x.parent = c; return x; }); }
    if (it.typename === 'TextFrame') { c.textRange = { characterAttributes: { fillColor: it.textRange.characterAttributes.fillColor, size: 12 } }; }
    return c;
}
function boundsUnion(list) {
    var r = null; list.forEach(function (b) { if (!b) { return; } if (!r) { r = b.slice(); } else { r = [Math.min(r[0], b[0]), Math.max(r[1], b[1]), Math.max(r[2], b[2]), Math.min(r[3], b[3])]; } });
    return r;
}
function PathItem() { Base.call(this, 'PathItem'); this.pathPoints = []; this.closed = true; this.filled = true; this.stroked = false; this.fillColor = cmyk(0, 0, 0, 100); this.strokeColor = { typename: 'NoColor' }; this.clipping = false; this.guides = false; this.strokeWidth = 1; }
PathItem.prototype = Object.create(Base.prototype);
Object.defineProperty(PathItem.prototype, 'geometricBounds', { get: function () {
    var xs = this.pathPoints.map(function (p) { return p.anchor[0]; }), ys = this.pathPoints.map(function (p) { return p.anchor[1]; });
    return [Math.min.apply(null, xs), Math.max.apply(null, ys), Math.max.apply(null, xs), Math.min.apply(null, ys)];
} });
PathItem.prototype.setEntirePath = function (pts) { this.pathPoints = pts.map(function (p) { return { anchor: p.slice(), leftDirection: p.slice(), rightDirection: p.slice() }; }); };
function CompoundPathItem() { Base.call(this, 'CompoundPathItem'); this.pathItems = []; }
CompoundPathItem.prototype = Object.create(Base.prototype);
Object.defineProperty(CompoundPathItem.prototype, 'geometricBounds', { get: function () { return boundsUnion(this.pathItems.map(function (p) { return p.geometricBounds; })); } });
function GroupItem() { Base.call(this, 'GroupItem'); this.pageItems = []; this.clipped = false; }
GroupItem.prototype = Object.create(Base.prototype);
Object.defineProperty(GroupItem.prototype, 'geometricBounds', { get: function () {
    if (this.clipped) { for (var i = 0; i < this.pageItems.length; i++) { if (this.pageItems[i].clipping) { return this.pageItems[i].geometricBounds; } } }
    return boundsUnion(this.pageItems.filter(function (p) { return !p.hidden; }).map(function (p) { return p.geometricBounds; }));
} });
function TextFrame(contents, b) { Base.call(this, 'TextFrame'); this.contents = contents; this._b = b; this.textRange = { characterAttributes: { fillColor: cmyk(0, 0, 0, 100), size: 12 } }; }
TextFrame.prototype = Object.create(Base.prototype);
Object.defineProperty(TextFrame.prototype, 'geometricBounds', { get: function () { return this._b.slice(); } });
Object.defineProperty(TextFrame.prototype, 'position', { set: function (p) { var w = this._b[2] - this._b[0], h = this._b[1] - this._b[3]; this._b = [p[0], p[1], p[0] + w, p[1] - h]; }, get: function () { return [this._b[0], this._b[1]]; } });
TextFrame.prototype.createOutline = function () {
    var g = new GroupItem(), b = this._b, p = rectPath(b[0], b[1], b[2], b[3], this.textRange.characterAttributes.fillColor);
    g.pageItems.push(p); p.parent = g;
    var a = this.parent.pageItems, i = a.indexOf(this); a[i] = g; g.parent = this.parent; this.parent = null;
    return g;
};
function rectPath(l, t, r, b, col) { var p = new PathItem(); p.setEntirePath([[l, t], [r, t], [r, b], [l, b]]); if (col) { p.fillColor = col; } return p; }
function Layer(name) {
    Base.call(this, 'Layer'); this.name = name || 'Calque'; this.visible = true; this.printable = true; this.pageItems = []; this.layers = [];
    var self = this;
    this.pathItems = { add: function () { var p = new PathItem(); p.parent = self; self.pageItems.unshift(p); return p; },
                       ellipse: function (t, l, w, h) { var p = new PathItem(); p.setEntirePath([[l, t], [l + w, t], [l + w, t - h], [l, t - h]]); p.parent = self; self.pageItems.unshift(p); return p; } };
    this.textFrames = { add: function () { var tf = new TextFrame('', [0, 10, 100, 0]); tf.parent = self; self.pageItems.unshift(tf); return tf; } };
}
Layer.prototype.remove = function () { var a = this.parent.layers, i = a.indexOf(this); a.splice(i, 1); };
Layer.prototype.zOrder = function () { var a = this.parent.layers, i = a.indexOf(this); a.splice(i, 1); a.unshift(this); };
function Doc(cs) {
    var self = this; this.name = 'essai.ai'; this.documentColorSpace = cs || 'CMYK'; this.selection = [];
    this.layers = []; this.layers.add = function () { var l = new Layer('Calque ' + (self.layers.length + 1)); l.parent = self; self.layers.unshift(l); return l; };
    this.artboards = [];
    Object.defineProperty(this, 'pageItems', { get: function () {
        var out = [];
        function walk(c) { (c.pageItems || []).forEach(function (it) { out.push(it); if (it.typename === 'GroupItem') { walk(it); } }); (c.layers || []).forEach(walk); }
        self.layers.forEach(walk); return out;
    } });
}
function layerIn(doc, name) { var l = new Layer(name); l.parent = doc; doc.layers.push(l); return l; }
function add(container, it) { container.pageItems.push(it); it.parent = container; return it; }

// ---- logo de référence (40 × 20 mm environ) / reference logo ----
var MM = 72 / 25.4, cR = cmyk(0, 100, 100, 0), cB = cmyk(100, 60, 0, 10), cK = cmyk(0, 0, 0, 100);
function mkPath(pts, col, closed) {
    var p = new PathItem();
    p.pathPoints = pts.map(function (q) { return { anchor: [q[0], q[1]], leftDirection: [q[2] !== undefined ? q[2] : q[0], q[3] !== undefined ? q[3] : q[1]], rightDirection: [q[4] !== undefined ? q[4] : q[0], q[5] !== undefined ? q[5] : q[1]] }; });
    p.fillColor = col; p.closed = closed !== false; return p;
}
function starPts() { var o = [], i, r; for (i = 0; i < 10; i++) { r = i % 2 ? 12 : 28; o.push([28 + r * Math.cos(i * Math.PI / 5 + 0.3), 28.3 + r * Math.sin(i * Math.PI / 5 + 0.3)]); } return o; }
function circlePts(cx, cy, r) { var k = 0.5523 * r; return [[cx + r, cy, cx + r, cy - k, cx + r, cy + k], [cx, cy + r, cx + k, cy + r, cx - k, cy + r], [cx - r, cy, cx - r, cy + k, cx - r, cy - k], [cx, cy - r, cx - k, cy - r, cx + k, cy - r]]; }
function makeLogo(T, cols) {
    cols = cols || [cR, cB, cK];
    function tp(q) { var o = [], i; for (i = 0; i < q.length; i += 2) { var x = q[i], y = q[i + 1]; o.push(T.a * x + T.b * y + T.e, T.c * x + T.d * y + T.f); } return o; }
    function tr(pts) { return pts.map(function (q) { var full = q.length === 6 ? q : [q[0], q[1], q[0], q[1], q[0], q[1]]; return tp(full); }); }
    var g = new GroupItem();
    var star = mkPath(tr(starPts()), cols[0]);
    var cp = new CompoundPathItem();
    var o1 = mkPath(tr([[60, 50], [100, 50], [100, 6], [60, 6]]), cols[1]), o2 = mkPath(tr([[70, 40], [90, 40], [90, 16], [70, 16]]), cols[1]);
    cp.pathItems.push(o1, o2); o1.parent = cp; o2.parent = cp;
    var circ = mkPath(tr(circlePts(107, 28.3, 6)), cols[2]);
    add(g, star); add(g, cp); add(g, circ);
    return g;
}
function Tr(s, ang, x, y, sx2, flip) { var a = ang * Math.PI / 180, sy = (sx2 || s) * (flip ? -1 : 1); return { a: s * Math.cos(a), b: -sy * Math.sin(a), c: s * Math.sin(a), d: sy * Math.cos(a), e: x, f: y }; }

function buildDoc() {
    var doc = new Doc('CMYK');
    doc.artboards = [{ name: 'Affiche', artboardRect: [0, 2000, 3000, 0] }, { name: 'Carte', artboardRect: [3200, 2000, 4200, 0] }];
    var top = layerIn(doc, 'Contenu'), fond = layerIn(doc, 'Fond'), cache = layerIn(doc, 'Masqué'); cache.visible = false;
    var L = {};
    L.ref = add(top, makeLogo(Tr(1, 0, -1000, 500)));                 // table de montage
    L.ok = add(top, makeLogo(Tr(1.5, 0, 200, 1700)));                 // conforme
    L.small = add(top, makeLogo(Tr(0.3, 0, 700, 1700)));              // trop petit
    L.dist = add(top, makeLogo(Tr(1.2, 0, 1100, 1700, 1)));           // déformé
    L.rot = add(top, makeLogo(Tr(1, 30, 1700, 1650)));                // tourné 30°
    L.flip = add(top, makeLogo(Tr(1, 0, 2300, 1700, 1, true)));       // miroir
    L.text = add(top, makeLogo(Tr(1, 0, 200, 1200)));                 // texte trop près
    add(top, new TextFrame('Prix 990 DA', [200 + 113.4 + 5 * MM, 1200 + 40, 200 + 113.4 + 5 * MM + 60, 1200 + 20]));
    L.bg = add(top, makeLogo(Tr(1, 0, 700, 1200)));                   // sur un fond
    add(fond, rectPath(600, 1350, 900, 1100, cmyk(0, 0, 0, 5)));
    L.edge = add(top, makeLogo(Tr(1, 0, 10, 800)));                   // trop près du bord
    L.black = add(top, makeLogo(Tr(1, 0, 1100, 1200), [cK, cK, cK])); // version noire
    L.wrong = add(top, makeLogo(Tr(1, 0, 1500, 1200), [cB, cR, cK])); // couleurs inversées
    var clipG = add(top, new GroupItem()); clipG.clipped = true;     // rogné
    var cpth = rectPath(1900, 1260, 1960, 1180); cpth.clipping = true; add(clipG, cpth);
    L.mask = add(clipG, makeLogo(Tr(1, 0, 1900, 1200)));
    L.opac = add(top, makeLogo(Tr(1, 0, 2300, 1200))); L.opac.opacity = 50; // transparent
    L.near1 = add(top, makeLogo(Tr(1, 0, 200, 400)));                  // deux logos collés
    L.near2 = add(top, makeLogo(Tr(1, 0, 200 + 113.4 + 3 * MM, 400)));
    L.card = add(top, makeLogo(Tr(0.8, 90, 3700, 900)));               // plan 2, tourné 90°
    L.hidden = add(cache, makeLogo(Tr(1, 0, 1500, 500)));              // calque masqué
    var other = add(top, new GroupItem()); add(other, mkPath(starPts(), cR));         // structure différente
    var bigBg = add(fond, rectPath(-5000, 5000, 9000, -5000, cmyk(0, 0, 0, 0)));     // fond blanc général
    return { doc: doc, L: L };
}

// ---- chargement du script / load script ----
global.app = { documents: [], activeDocument: null, locale: 'fr_FR' };
global.CL_TEST = true;
var src = fs.readFileSync(path.join(__dirname, '..', 'ConformiteLogo.jsx'), 'utf8').replace(/^#target.*$/mg, '');
vm.runInThisContext(src, { filename: 'ConformiteLogo.jsx' });

// 1. pas de document
alerts = []; main(); ok(alerts.length === 1 && /Aucun document/.test(alerts[0]), 'alerte sans document');
var S = buildDoc(); app.documents = [S.doc]; app.activeDocument = S.doc;
// 2. rien de sélectionné, pas de référence
alerts = []; main(); ok(/Sélectionnez le logo de référence/.test(alerts[0]), 'alerte sans sélection');
// 3. deux objets sélectionnés
S.doc.selection = [S.L.ok, S.L.small]; alerts = []; main(); ok(/un seul objet/.test(alerts[0]), 'alerte deux objets');

function ui(mode, over) {
    return function (ref, stored, prefs) {
        var k; for (k in (over || {})) { prefs[k] = over[k]; }
        return { mode: mode, prefs: prefs, rules: rulesFromPrefs(prefs, ref), remember: true, _ref: ref, _stored: stored };
    };
}
// 4. contrôle complet / full check
S.doc.selection = [S.L.ref]; alerts = [];
var r = main(ui('run', { report: true }));
var data = r.data, res = data.results;
ok(r._ref.nPts === 22 && r._ref.kind === 'art', 'référence lue : ' + r._ref.nPts + ' points');
ok(data.skipped === 1, 'référence sur la table de montage ignorée : ' + data.skipped);
ok(res.length === 15, 'copies contrôlées : ' + res.length);
function find(it) { for (var i = 0; i < res.length; i++) { if (res[i].item === it) { return res[i]; } } return null; }
function codes(x) { return x ? x.ev.issues.map(function (i) { return i.code; }).sort().join(',') : 'ABSENT'; }
ok(codes(find(S.L.ok)) === '', 'conforme : ' + codes(find(S.L.ok)));
ok(codes(find(S.L.small)) === 'size', 'trop petit : ' + codes(find(S.L.small)));
ok(codes(find(S.L.dist)) === 'distort', 'déformé : ' + codes(find(S.L.dist)));
ok(codes(find(S.L.rot)) === '', 'rotation autorisée par défaut : ' + codes(find(S.L.rot)));
ok(codes(find(S.L.flip)) === 'flip', 'miroir : ' + codes(find(S.L.flip)));
var ft = find(S.L.text); ok(codes(ft) === 'clear' && /texte/.test(ft.ev.issues[0].text) && /0,5/.test(ft.ev.issues[0].text), 'texte dans la zone : ' + (ft && ft.ev.issues[0] && ft.ev.issues[0].text));
ok(codes(find(S.L.bg)) === '', 'logo sur un fond : ' + codes(find(S.L.bg)));
ok(codes(find(S.L.edge)) === 'edge', 'trop près du bord : ' + codes(find(S.L.edge)));
ok(codes(find(S.L.black)) === '', 'version noire autorisée : ' + codes(find(S.L.black)));
ok(codes(find(S.L.wrong)) === 'colors', 'couleurs inversées : ' + codes(find(S.L.wrong)));
ok(codes(find(S.L.mask)) === 'mask', 'rogné par masque : ' + codes(find(S.L.mask)));
ok(codes(find(S.L.opac)) === 'opacity' && /50 %/.test(find(S.L.opac).ev.issues[0].text), 'opacité 50 % : ' + codes(find(S.L.opac)));
ok(codes(find(S.L.near1)) === 'clear' && codes(find(S.L.near2)) === 'clear' && /autre logo/.test(find(S.L.near1).ev.issues[0].text), 'deux logos collés : ' + codes(find(S.L.near1)));
var fc = find(S.L.card); ok(codes(fc) === '' && fc.artboard.name === 'Carte' && Math.abs(fc.ev.dec.rotation - 90) < 1e-6, 'plan 2, 90° : ' + codes(fc));
ok(find(S.L.hidden) === null, 'calque masqué ignoré');
var rb = r._ref.bounds; ok(Math.abs(find(S.L.ok).ev.w - 1.5 * (rb[2] - rb[0])) < 1e-6 && Math.abs(find(S.L.small).ev.h - 0.3 * (rb[1] - rb[3])) < 1e-6, 'largeur / hauteur mesurées : ' + find(S.L.ok).ev.w);
// repères, sélection, nettoyage
var mk = S.doc.layers.filter(function (l) { return /Conformité logo/.test(l.name); });
ok(mk.length === 1 && mk[0].printable === false && S.doc.layers[0] === mk[0], 'calque de repères non imprimable en haut');
ok(mk[0].pageItems.filter(function (p) { return p.typename === 'TextFrame'; }).length === 15, 'une étiquette par logo');
ok(S.doc.layers.filter(function (l) { return l.name === '__ConformiteLogo_tmp'; }).length === 0, 'calques temporaires supprimés');
ok(S.L.small.selected && S.L.wrong.selected && !S.L.ok.selected && !S.L.bg.selected, 'sélection des logos à corriger');
ok(S.L.ref.note.indexOf('[ConformiteLogo:ref]') >= 0, 'référence mémorisée dans la note');
ok(files['/desk/essai_conformite-logo.txt'] && /Logo 1/.test(files['/desk/essai_conformite-logo.txt']), 'rapport .txt écrit');
ok(files['/ud/ConformiteLogo.prefs'] && /report=true/.test(files['/ud/ConformiteLogo.prefs']), 'réglages enregistrés');
ok(/15 logo\(s\) contrôlé\(s\)/.test(alerts[alerts.length - 1]), 'résumé : ' + alerts[alerts.length - 1].split('\n')[0]);
// géométrie intacte : aucun point d'un logo n'a bougé
ok(S.L.small.pageItems[0].pathPoints[0].anchor[0] === makeLogo(Tr(0.3, 0, 700, 1700)).pageItems[0].pathPoints[0].anchor[0], 'illustration non modifiée');

// 5. relance sans sélection : référence mémorisée, règles plus strictes
S.doc.selection = []; alerts = [];
r = main(ui('analyse', { rotPolicy: 1, minSize: '50', report: false }));
ok(r._stored === true, 'référence retrouvée par la note');
ok(codes(r.data.results.filter(function (x) { return x.item === S.L.rot; })[0]) === 'rotate,size', 'rotation 30° refusée en 0/90 + taille 50 mm');
ok(codes(r.data.results.filter(function (x) { return x.item === S.L.card; })[0]) === 'size', 'carte 90° acceptée en 0/90 (seulement trop petite)');
ok(/analyse seule/.test(alerts[alerts.length - 1]), 'analyse sans modification');
// 6. effacer les repères
r = main(ui('clear'));
ok(S.doc.layers.filter(function (l) { return /Conformité logo/.test(l.name); }).length === 0, 'repères effacés');
// 7. symbole simulé : référence de type image incorporée refusée pour couleurs + type non géré
var g2 = new Base('MeshItem'); S.doc.selection = [g2]; alerts = []; main(ui('run'));
ok(/ne peut pas servir/.test(alerts[0]), 'type non géré refusé');
// 8. logo avec texte vivant (vectorisé en coulisse)
var D2 = new Doc('RGB'); D2.artboards = [{ name: 'A', artboardRect: [0, 1000, 1000, 0] }];
var l2 = layerIn(D2, 'C');
function txtLogo(x, y, s) { var g = new GroupItem(); add(g, mkPath([[x, y], [x + 30 * s, y], [x + 30 * s, y + 30 * s], [x, y + 30 * s]], cR)); add(g, mkPath([[x + 2 * s, y + 2 * s], [x + 8 * s, y + 2 * s], [x + 5 * s, y + 9 * s]], cR)); add(g, new TextFrame('ACME', [x + 35 * s, y + 25 * s, x + 95 * s, y + 5 * s])); return g; }
var t1 = add(l2, txtLogo(100, 600, 1)), t2 = add(l2, txtLogo(400, 600, 1.4)), t3 = add(l2, txtLogo(100, 200, 1));
t3.pageItems[2].contents = 'AUTRE';
D2.selection = [t1]; app.documents = [D2]; app.activeDocument = D2; alerts = [];
r = main(ui('run', { minSize: '10' }));
ok(r.data.results.length === 2, 'logo avec texte : 2 copies (texte différent exclu) : ' + r.data.results.length);
ok(D2.layers.filter(function (l) { return l.name === '__ConformiteLogo_tmp'; }).length === 0 && t1.pageItems[2].typename === 'TextFrame', 'texte original intact, copie temporaire supprimée');
var mk2 = D2.layers.filter(function (l) { return /Conformité logo/.test(l.name); })[0];
ok(mk2 && mk2.pageItems.some(function (p) { return p.typename === 'PathItem' && p.strokeColor.typename === 'RGBColor'; }), 'repères en RVB dans un document RVB');
// 9. interface anglaise
app.locale = 'en_US'; CLUI.fr = false; app.documents = []; alerts = []; main(); ok(/No document is open/.test(alerts[0]), 'message anglais');

console.log('Simulation : ' + pass + ' réussis, ' + fail + ' échecs');
process.exit(fail ? 1 : 0);
