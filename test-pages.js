// 回归测试：用 Node vm + DOM stub 覆盖所有工具页的核心逻辑
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const commonJs = fs.readFileSync(path.join(ROOT, 'assets/common.js'), 'utf8');

// 跨页面共享的内存 localStorage，用于持久化测试
const memStore = {};
const memStorage = {
    getItem: (k) => (k in memStore ? memStore[k] : null),
    setItem: (k, v) => { memStore[k] = String(v); },
    removeItem: (k) => { delete memStore[k]; }
};

function loadPage(rel, extra, preJs) {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    if (!m) throw new Error(rel + ': no inline script found');
    const els = {};
    const listeners = {};
    function makeEl(id) {
        return {
            id, value: '', innerHTML: '', textContent: '', className: '',
            style: {}, checked: false, dataset: {}, offsetWidth: 100,
            classList: { add() {}, remove() {}, toggle() {} },
            appendChild() {}, remove() {},
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
            addEventListener(type, fn) { (listeners[id + ':' + type] = listeners[id + ':' + type] || []).push(fn); }
        };
    }
    const sandbox = {
        console,
        setTimeout() {},
        setInterval() {},
        navigator: {},
        TextEncoder, TextDecoder, Uint8Array, JSON,
        localStorage: memStorage,
        btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        document: {
            getElementById(id) { return els[id] || (els[id] = makeEl(id)); },
            createElement() { return makeEl('dyn'); },
            activeElement: null,
            // 仅 hash.html 使用：默认勾选与页面一致的 md5 + SHA-256
            querySelectorAll(sel) {
                return sel === '.algo'
                    ? [{ checked: true, value: 'md5' }, { checked: true, value: 'SHA-256' }]
                    : [];
            }
        }
    };
    Object.assign(sandbox, extra || {});
    const ctx = vm.createContext(sandbox);
    vm.runInContext((preJs ? preJs + '\n' : '') + commonJs + '\n' + m[1], ctx);
    return { ctx, els, listeners };
}

let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name); }
}
function finish() {
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
}

// ---- encode.html ----
{
    const { ctx, els } = loadPage('encode/encode.html');
    els['input'].value = '你好 world! &x=1';
    const b64 = ctx.b64encodeText(els['input'].value);
    check('b64 编码中文', b64 === Buffer.from('你好 world! &x=1', 'utf8').toString('base64'));
    check('b64 解码回环', ctx.b64decodeText(b64) === '你好 world! &x=1');
    check('b64 解码忽略空白', ctx.b64decodeText(b64.slice(0, 4) + '\n' + b64.slice(4)) === '你好 world! &x=1');
    let threw = false;
    try { ctx.b64decodeText('!!!not-base64'); } catch (e) { threw = true; }
    check('b64 非法输入报错', threw);
    check('url 编码', ctx.urlEncodeText('a b&c=1') === 'a%20b%26c%3D1');
    els['keepAscii'].checked = true;
    check('url encodeURI 风格', ctx.urlEncodeText('http://a.com/x?y=1 2') === 'http://a.com/x?y=1%202');
    check('url 解码回环', ctx.urlDecodeText('a%20b%26c%3D1') === 'a b&c=1');
    ctx.run(ctx.b64encodeText, 'ok');
    check('run 写入输出', els['output'].value === b64 && els['statusBadge'].className.includes('badge-ok'));
}

// ---- replace.html ----
{
    const { ctx, els, listeners } = loadPage('str/replace.html');
    check('默认无规则', ctx.rules.length === 0);
    ctx.addRule(); ctx.addRule();
    ctx.rules[0] = ['tree2053.hh7758521.top:10086', 'tree10086.hh7758521.top:443'];
    ctx.rules[1] = ['&security=none', 'tls=true'];
    ctx.renderRules();
    check('规则渲染', els['rulesList'].innerHTML.includes('tree2053') && els['rulesList'].innerHTML.includes('data-idx="1"'));
    els['input'].value = 's tree2053.hh7758521.top:10086 &security=none';
    ctx.doReplace();
    check('替换结果', els['output'].value === 's tree10086.hh7758521.top:443 tls=true');
    check('状态徽章', els['statusBadge'].textContent === '已应用 2 条规则');
    // 事件委托：修改查找框
    const inputFns = listeners['rulesList:input'] || [];
    inputFns.forEach(fn => fn({
        target: { dataset: { idx: '0' }, classList: { contains: c => c === 'find' }, value: 'foo' }
    }));
    check('委托写回规则', ctx.rules[0][0] === 'foo');
    // 事件委托：删除按钮
    const before = ctx.rules.length;
    const clickFns = listeners['rulesList:click'] || [];
    clickFns.forEach(fn => fn({ target: { closest: () => ({ dataset: { idx: '1' } }) } }));
    check('委托删除规则', ctx.rules.length === before - 1 && ctx.rules[0][0] === 'foo');
    ctx.addRule();
    check('添加规则', ctx.rules.length === 2);
    // 持久化：保存后重新加载页面，规则应恢复
    ctx.saveRules();
    const p2 = loadPage('str/replace.html');
    check('规则持久化', p2.ctx.rules.length === 2 && p2.ctx.rules[0][0] === 'foo');
}

// ---- json.html ----
{
    const { ctx, els } = loadPage('json-tools/json.html');
    els['indentSelect'].value = '2';
    ctx.loadSample();
    const sample = els['input'].value;
    check('示例是有效 JSON', (() => { try { JSON.parse(sample); return true; } catch (e) { return false; } })());
    ctx.format();
    const out = els['output'].value;
    check('格式化输出可解析', (() => { try { JSON.parse(out); return true; } catch (e) { return false; } })());
    check('格式化缩进', out.includes('\n  "name": "张三"'));
    check('树视图渲染', els['treeContent'].innerHTML.includes('tree-key'));
    check('摘要栏', els['summaryBar'].textContent.includes('节点'));
    ctx.collapseAll();
    check('全部折叠显示属性数', els['treeContent'].innerHTML.includes('个属性'));
    ctx.expandAll();
    check('全部展开还原', !els['treeContent'].innerHTML.includes('个属性'));
    ctx.minify();
    check('压缩无换行', !els['output'].value.includes('\n'));
    els['input'].value = 'a"b\\c';
    ctx.escapeJson();
    check('转义', els['output'].value === 'a\\"b\\\\c');
    els['input'].value = els['output'].value;
    ctx.unescapeJson();
    check('反转义回环', els['output'].value === 'a"b\\c');
    els['input'].value = '{bad json';
    ctx.format();
    check('解析失败状态', els['statusBadge'].className.includes('badge-err') && els['errorDetail'].style.display === 'block');
    check('switchView 文本模式', (ctx.switchView('text'), els['textView'].style.display === 'flex'));
}

// ---- node.html ----
{
    const { ctx, els, listeners } = loadPage('node/node.html');
    // 构造四类测试链接
    const vmessObj = { v: '2', ps: '测试节点', add: 'a.example.com', port: 443, id: 'uuid-1', aid: 0, scy: 'auto', net: 'ws', type: 'none', host: '', path: '/ws', tls: 'tls', sni: 'a.example.com' };
    const b64u = (s) => Buffer.from(s, 'utf8').toString('base64');
    const links = [
        'vmess://' + b64u(JSON.stringify(vmessObj)),
        'trojan://pass%40123@b.example.com:443?security=tls&sni=b.example.com#' + encodeURIComponent('Trojan节点'),
        'ss://' + Buffer.from('aes-256-gcm:secret', 'utf8').toString('base64url') + '@c.example.com:8388#' + encodeURIComponent('SS节点'),
        'ssr://' + b64u(['d.example.com', '443', 'auth_aes128_md5', 'aes-128-cfb', 'tls1.2_ticket_auth', Buffer.from('ssrpass', 'utf8').toString('base64')].join(':') + '/?remarks=' + Buffer.from('SSR节点', 'utf8').toString('base64url'))
    ];
    els['input'].value = links.join('\n');
    ctx.parseAll();
    check('vmess 解析', ctx.nodes.length === 4 && ctx.nodes[0]._type === 'vmess' && ctx.nodes[0].obj.add === 'a.example.com');
    check('trojan 解析', ctx.nodes[1].password === 'pass@123' && ctx.nodes[1].name === 'Trojan节点' && ctx.nodes[1].query === 'security=tls&sni=b.example.com');
    check('ss 解析', ctx.nodes[2].method === 'aes-256-gcm' && ctx.nodes[2].password === 'secret');
    check('ssr 解析', ctx.nodes[3].password === 'ssrpass' && ctx.nodes[3].name === 'SSR节点');
    check('节点卡片渲染', els['nodes'].innerHTML.includes('node-card') && els['nodes'].innerHTML.includes('b-vmess'));
    // 委托修改 vmess 地址
    const inputFns = listeners['nodes:input'] || [];
    inputFns.forEach(fn => fn({
        target: { dataset: { f: 'add' }, value: 'new.example.com', closest: () => ({ dataset: { i: '0' } }) }
    }));
    check('委托改地址', ctx.nodes[0].obj.add === 'new.example.com');
    // 生成回环：重新解析生成的链接应与修改后一致
    ctx.generateAll();
    const out = els['output'].value.split('\n');
    const re = ctx.parseLink(out[0]);
    check('vmess 生成回环', re.add === 'new.example.com' && re.ps === '测试节点' && re.port === 443);
    const reTrojan = ctx.parseLink(out[1]);
    check('trojan 生成回环', reTrojan.host === 'b.example.com' && reTrojan.password === 'pass@123');
    const reSS = ctx.parseLink(out[2]);
    check('ss 生成回环', reSS.method === 'aes-256-gcm' && reSS.host === 'c.example.com');
    const reSSR = ctx.parseLink(out[3]);
    check('ssr 生成回环', reSSR.host === 'd.example.com' && reSSR.password === 'ssrpass' && reSSR.name === 'SSR节点');
    let threw = false;
    try { ctx.parseLink('ftp://x'); } catch (e) { threw = true; }
    check('非法链接报错', threw);
    ctx.removeNode(0);
    check('删除节点', ctx.nodes.length === 3);
}

// ---- diff.html ----
{
    const { ctx, els } = loadPage('diff/diff.html');
    const rows = ctx.diffLines('a\nb\nc\nd', 'a\nx\nc\ny');
    const types = rows.map(r => r.t).join(',');
    check('diff 基本', types === 'same,del,add,same,del,add');
    const same = ctx.diffLines('a\nb', 'a\nb');
    check('diff 相同文本', same.every(r => r.t === 'same' && r.an === r.bn));
    check('diff 行号', rows[1].an === 2 && rows[1].bn === undefined && rows[2].bn === 2);
    els['inputA'].value = 'server = a.example.com\nport = 443';
    els['inputB'].value = 'server = b.example.com\nport = 443';
    ctx.doDiff();
    check('并排视图渲染', els['diffResult'].innerHTML.includes('sd-row change'));
    check('行内高亮标记', els['diffResult'].innerHTML.includes('part-del') && els['diffResult'].innerHTML.includes('part-add'));
    check('diff 统计', els['diffBadge'].textContent === '+1 / -1');
    // 完全不相似的行不配成"修改"
    els['inputA'].value = 'x\ny';
    els['inputB'].value = 'x';
    ctx.doDiff();
    check('纯删除行', els['diffResult'].innerHTML.includes('sd-row del') && !els['diffResult'].innerHTML.includes('sd-row change'));
    // 回归：删除一行 + 修改一行，配对不能错位
    const u = ctx.buildUnits(ctx.diffLines(
        'heihei\nrens\naaa\ndawdwadawdd\n  dwadwa\ndwdada',
        'heihei\nrens\ndawdwadawd\n  dwadwa\ndwdada'));
    check('相似度配对不误配', u.length === 6 &&
        u[2].t === 'del' && u[2].aHtml.includes('aaa') &&
        u[3].t === 'change' && u[3].aHtml.includes('part-del') && u[3].bHtml.includes('dawdwadawd'));
    check('单元保留原文', u[3].aText === 'dawdwadawdd' && u[3].bText === 'dawdwadawd');
    const seg = ctx.inlineDiff('abcde', 'abXde');
    check('inlineDiff 段落', seg.a.length === 3 && seg.a[1].t === 'chg' && seg.a[1].text === 'c' && seg.b[1].text === 'X');
    check('inlineDiff 完全相同', ctx.inlineDiff('same', 'same').a.every(s => s.t === 'same'));
    ctx.ignoreCase = true; ctx.ignoreWs = false;
    check('忽略大小写', ctx.diffLines('AbC', 'abc').every(r => r.t === 'same'));
    ctx.ignoreCase = false; ctx.ignoreWs = true;
    check('忽略首尾空白', ctx.diffLines('abc  ', '  abc').every(r => r.t === 'same'));
    ctx.ignoreWs = false;
    // 多行改动配对后行内高亮，多余行整行标色
    const html2 = ctx.renderUnified(ctx.buildUnits(ctx.diffLines('l1\nfoo1\nbar', 'l1\nfoo2\nbaz\nbax')));
    check('配对渲染', html2.includes('part-del') && html2.split('diff-row del').length === 3);
    // 长未变更段折叠
    const longA = Array.from({ length: 16 }, (_, k) => 'line' + k).join('\n');
    const longB = Array.from({ length: 16 }, (_, k) => k === 3 ? 'CHANGED' : 'line' + k).join('\n');
    els['inputA'].value = longA;
    els['inputB'].value = longB;
    ctx.doDiff();
    check('未变更段折叠', els['diffResult'].innerHTML.includes('展开 6 行未更改'));
    ctx.toggleFold(5);
    check('展开折叠段', !els['diffResult'].innerHTML.includes('展开 6 行未更改') &&
        (els['diffResult'].innerHTML.match(/sd-row same/g) || []).length === 15);
    ctx.switchView('unified');
    check('统一视图渲染', els['diffResult'].innerHTML.includes('diff-row del') && els['diffResult'].innerHTML.includes('diff-row add'));
    check('统一视图配对标记', els['diffResult'].innerHTML.includes('diff-row del paired') && els['diffResult'].innerHTML.includes('diff-row add paired'));
}

// ---- time.html ----
{
    const { ctx, els } = loadPage('time/time.html');
    const $id = ctx.$;
    // datetime-local 使用本地时间，构造时按本地解析
    const d = new Date(2026, 8, 17, 12, 0, 0); // 2026-09-17 12:00:00 本地
    $id('tsInput').value = String(d.getTime());
    ctx.tsToDate();
    check('毫秒时间戳转换', $id('tsResult').innerHTML.includes('2026-09-17 12:00:00'));
    $id('tsInput').value = String(Math.floor(d.getTime() / 1000));
    ctx.tsToDate();
    check('秒时间戳转换', $id('tsResult').innerHTML.includes('2026-09-17 12:00:00'));
    const pad = n => (n < 10 ? '0' + n : '' + n);
    $id('dtInput').value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T12:00:00';
    ctx.dateToTs();
    check('日期转时间戳', $id('dtResult').innerHTML.includes(Math.floor(d.getTime() / 1000)));
    check('相对时间', ctx.relTime(new Date(Date.now() - 3600000)) === '1 小时前');
}

// ---- table.html ----
{
    const { ctx, els } = loadPage('table/table.html');
    // MD 解析：围栏 + 转义竖线 + 不齐行补齐
    const rows = ctx.parseMarkdownTable('```md\n| 名称 | 说明 |\n| --- | --- |\n| a\\|b | 包含\\|竖线 |\n| 短 |\n```');
    check('MD 解析', rows.length === 3 && rows[1][0] === 'a|b' && rows[2][1] === '');
    check('MD 检测', ctx.detectFormat('| a |\n| --- |\n| b |') === 'md');
    check('CSV 检测', ctx.detectFormat('a,b\n1,2') === 'csv');
    check('CSV 引号解析', JSON.stringify(ctx.parseCsv('a,"b,c","d""e"\n1,2,3', ',')[0]) === JSON.stringify(['a', 'b,c', 'd"e']));
    check('CSV 分隔符识别', ctx.detectCsvDelim('a\tb\n1\t2') === '\t');
    // MD → CSV 引号包裹
    check('MD 转 CSV 转义', ctx.mdToCsv('| x | y |\n| --- | --- |\n| 含,逗号 | 含"引号 |', ',') === 'x,y\n"含,逗号","含""引号"');
    check('CSV 转 MD', ctx.csvToMd('name,age\n张三,28', ',') === '| name | age |\n| --- | --- |\n| 张三 | 28 |');
    // 回环
    const md = '| name | age |\n| --- | --- |\n| 张三 | 28 |';
    check('MD CSV 回环', ctx.csvToMd(ctx.mdToCsv(md, ','), ',') === md);
    const md2 = '| a | b |\n| --- | --- |\n| x\\|y | z |';
    check('竖线转义回环', ctx.csvToMd(ctx.mdToCsv(md2, ','), ',') === md2);
    // convert 集成与错误路径
    els['input'].value = md;
    ctx.convert('auto');
    check('智能转换 MD→CSV', els['output'].value === 'name,age\n张三,28' && els['statusBadge'].className.includes('badge-ok'));
    els['input'].value = '随便一行字';
    ctx.convert('auto');
    check('无法识别报错', els['statusBadge'].className.includes('badge-err'));
}

// ---- img.html ----
{
    const { ctx } = loadPage('img/img.html');
    check('输出文件名', ctx.outputName('photo.png', 'image/jpeg') === 'photo-min.jpg');
    check('mime 扩展名', ctx.extForMime('image/webp') === '.webp' && ctx.extForMime('image/png') === '.png');
    ctx.saveSettings();
    const p2 = loadPage('img/img.html');
    check('设置持久化', JSON.stringify(p2.ctx.loadSettings()) === JSON.stringify(ctx.loadSettings()));
}

// ---- regex.html ----
{
    const { ctx, els } = loadPage('regex/regex.html');
    check('非法正则不抛异常', !!ctx.buildRegex('(', 'g').error && !ctx.buildRegex('\\d+', 'g').error);
    const ms = ctx.findMatches('\\d+', 'g', 'a1b22');
    check('findMatches 命中', ms.length === 2 && ms[0].text === '1' && ms[1].index === 3);
    const gs = ctx.findMatches('(b)(c)?', '', 'abc');
    check('无 g 强制全局 + 分组', gs.length === 1 && gs[0].groups[0] === 'b');
    const zw = ctx.findMatches('x*', 'g', 'axb');
    check('零宽匹配不死循环', zw.length === 4 && zw.every(m => m.text !== undefined));
    ctx.renderMatches(ctx.findMatches('\\d+', 'g', 'a1b22'), 'a1b22');
    const mhtml = els['matchView'].innerHTML;
    check('匹配高亮渲染', mhtml.includes('<mark') && (mhtml.match(/<mark/g) || []).length === 2);
    els['pattern'].value = '(a)(b)';
    els['input'].value = 'xab';
    ctx.runTest();
    check('runTest 分组列表', els['matchList'].innerHTML.includes('$1'));
    check('runTest 状态徽章', els['statusBadge'].textContent === '正则有效' && els['matchBadge'].textContent === '1 个匹配');
    els['pattern'].value = '(';
    ctx.runTest();
    check('runTest 错误提示', els['statusBadge'].className.includes('badge-err'));
}

// ---- text.html ----
{
    const { ctx, els } = loadPage('text/text.html');
    const sample = '你好 world\n第二行';
    const st = ctx.textStats(sample);
    check('textStats 统计', st.cn === 5 && st.enWords === 1 && st.lines === 2 && st.chars === sample.length && st.noSpace === 10);
    check('textStats 空文本', ctx.textStats('').lines === 0 && ctx.textStats('').chars === 0);
    check('全角转半角', ctx.toHalf('ＡＢＣ１２３　x') === 'ABC123 x');
    check('半角转全角', ctx.toFull('ABC123 x') === 'ＡＢＣ１２３　ｘ');
    check('全角半角往返', ctx.toHalf(ctx.toFull('ABC123 x')) === 'ABC123 x');
    els['input'].value = 'b\na\nb\nc\na';
    ctx.applyOp('dedupe');
    check('行去重', els['output'].value === 'b\na\nc');
    els['input'].value = 'b\na\nc';
    ctx.applyOp('sortAsc');
    check('行升序', els['output'].value === 'a\nb\nc');
    els['input'].value = '10\n9\n2';
    ctx.applyOp('sortNum');
    check('行数值排序', els['output'].value === '2\n9\n10');
    els['input'].value = 'hello world-foo';
    ctx.applyOp('camel');
    check('camelCase', els['output'].value === 'helloWorldFoo');
    els['input'].value = 'Hello World';
    ctx.applyOp('snake');
    check('snake_case', els['output'].value === 'hello_world');
    els['input'].value = 'Hello World';
    ctx.applyOp('kebab');
    check('kebab-case', els['output'].value === 'hello-world');
    els['input'].value = 'a\n\nb\n';
    ctx.applyOp('dropEmpty');
    check('去空行', els['output'].value === 'a\nb');
    els['input'].value = '';
    ctx.applyOp('upper');
    check('空输入有保护', els['output'].value === 'a\nb');
}

// ---- gen.html ----
{
    const nodeCrypto = require('crypto');
    const { ctx, els } = loadPage('gen/gen.html', { crypto: nodeCrypto.webcrypto });
    check('uuidv4 格式', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(ctx.uuidv4()));
    const opts = { upper: true, lower: true, digit: true, symbol: true, len: 32, noAmb: false };
    const pw = ctx.passwordFromOptions(opts);
    check('密码长度', pw.length === 32);
    check('密码字符集覆盖', /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw));
    const pwAmb = ctx.passwordFromOptions({ upper: true, lower: true, digit: false, symbol: false, len: 16, noAmb: true });
    check('排除易混淆字符', !/[0O1lI]/.test(pwAmb));
    let threw = false;
    try { ctx.passwordFromOptions({ upper: false, lower: false, digit: false, symbol: false, len: 8, noAmb: false }); } catch (e) { threw = true; }
    check('空字符集报错', threw);
    threw = false;
    try { ctx.passwordFromOptions({ upper: true, lower: true, digit: true, symbol: true, len: 3, noAmb: false }); } catch (e) { threw = true; }
    check('长度小于字符集种类报错', threw);
    check('熵计算', ctx.entropyBits(10, 1024) === 100);
    let inRange = true;
    for (let i = 0; i < 300; i++) { const v = ctx.randInt(5, 10); if (v < 5 || v > 10) inRange = false; }
    check('randInt 范围', inRange);
    ctx.$('uuidCount').value = '3';
    ctx.genUuids();
    check('批量 UUID', ctx.$('uuidOut').textContent.split('\n').length === 3);
}

// ---- jwt.html ----
{
    const { ctx, els } = loadPage('jwt/jwt.html');
    const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const token = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' +
        b64u(JSON.stringify({ sub: '123', name: '张三', exp: now + 3600 })) + '.fakesig';
    const dec = ctx.decodeJwt(token);
    check('JWT 解码', dec.header.alg === 'HS256' && dec.payload.name === '张三');
    check('expInfo 有效', ctx.expInfo(now + 86400 * 2).state === 'ok');
    check('expInfo 即将过期', ctx.expInfo(now + 3600 - 100).state === 'soon');
    check('expInfo 已过期', ctx.expInfo(now - 100).state === 'dead');
    check('fmtDuration', ctx.fmtDuration(90061000) === '1 天 1 小时');
    let threw = false;
    try { ctx.decodeJwt('not-a-jwt'); } catch (e) { threw = true; }
    check('非法 JWT 报错', threw);
    threw = false;
    try { ctx.decodeJwt(b64u('{"a":1') + '.' + b64u('{}') + '.x'); } catch (e) { threw = true; }
    check('坏 JSON 报错', threw);
    els['input'].value = token;
    ctx.doParse();
    check('doParse 渲染', els['headerBlock'].textContent.includes('HS256') && els['payloadBlock'].textContent.includes('张三'));
    check('过期横幅', els['expBanner'].textContent.includes('有效期至'));
}

// ---- color.html ----
{
    const { ctx } = loadPage('color/color.html');
    check('hexToRgb', JSON.stringify(ctx.hexToRgb('#4a9eff')) === JSON.stringify({ r: 74, g: 158, b: 255 }));
    check('rgbToHex 回环', ctx.rgbToHex(74, 158, 255) === '#4a9eff');
    check('hexToRgb 非法', ctx.hexToRgb('#xyz') === null && ctx.hexToRgb('#ffff') === null);
    check('hexToRgb 三位简写', JSON.stringify(ctx.hexToRgb('#f80')) === JSON.stringify({ r: 255, g: 136, b: 0 }) &&
        JSON.stringify(ctx.hexToRgb('4a9eff')) === JSON.stringify({ r: 74, g: 158, b: 255 }));
    const comp = ctx.buildHarmony(30, 80, 50, 'comp');
    check('互补色两组对顶', comp.length === 2 && comp[0][0] === 30 && comp[1][0] === 210);
    const tri = ctx.buildHarmony(0, 80, 50, 'triad');
    check('三角色间隔 120', tri.length === 3 && tri[1][0] === 120 && tri[2][0] === 240);
    check('类似色五组居中', ctx.buildHarmony(200, 50, 40, 'analog').length === 5);
    const wrapH = ctx.buildHarmony(350, 50, 40, 'comp');
    check('色相拥绕 0/360', wrapH[1][0] === 170 && ctx.buildHarmony(10, 50, 40, 'analog')[0][0] === 310);
    check('调和色合法 hsl', ctx.buildHarmony(120, 60, 40, 'square').every(c => c[0] >= 0 && c[0] < 360 && c[1] === 60 && c[2] === 40));
    check('色域面板坐标', JSON.stringify(ctx.pickSv(120, 0, 0)) === JSON.stringify([120, 0, 100]) &&
        JSON.stringify(ctx.pickSv(120, 1, 1)) === JSON.stringify([120, 100, 0]) &&
        JSON.stringify(ctx.pickSv(120, 1, 0)) === JSON.stringify([120, 100, 50]));
    check('色域坐标越界夹取', JSON.stringify(ctx.pickSv(120, -1, 2)) === JSON.stringify([120, 0, 0]));
    const hslRed = ctx.rgbToHsl(255, 0, 0);
    const backRed = ctx.hslToRgb(hslRed.h, hslRed.s, hslRed.l);
    check('hsl 精确回环', JSON.stringify(backRed) === JSON.stringify({ r: 255, g: 0, b: 0 }));
    const hsl = ctx.rgbToHsl(74, 158, 255);
    const back = ctx.hslToRgb(hsl.h, hsl.s, hsl.l);
    check('hsl 近似回环', Math.abs(back.r - 74) <= 3 && Math.abs(back.g - 158) <= 3 && Math.abs(back.b - 255) <= 1);
    check('黑白对比度 21', Math.abs(ctx.contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }) - 21) < 0.1);
    check('WCAG 标签', ctx.wcagTag(21, 'AAA').includes('wcag-pass') && ctx.wcagTag(3, 'AA').includes('wcag-fail'));
    check('WCAG 大字标准', ctx.wcagTag(3, 'AA', true).includes('wcag-pass') &&
        ctx.wcagTag(3, 'AAA', true).includes('wcag-fail') && ctx.wcagTag(4.5, 'AAA', true).includes('wcag-pass'));
    check('对比度行大字补充', ctx.contrastLine(3.5).includes('大字可通过 AA') &&
        ctx.contrastLine(5).includes('大字可通过 AAA') && !ctx.contrastLine(7.5).includes('大字'));
    const advW = ctx.contrastAdvice(2.5, 7.6);
    check('对比度建议选更优一方', advW.label === '黑字' && advW.color === '#000000' && advW.ratio === 7.6 &&
        advW.level.includes('AAA'));
    const advL = ctx.contrastAdvice(3.2, 2.0);
    check('对比度建议大字兜底', advL.label === '白字' && advL.level.includes('大字'));
    ctx.setFromRgb(255, 0, 0);
    check('setFromRgb 联动', JSON.stringify(ctx.current) === JSON.stringify({ r: 255, g: 0, b: 0 }));
}

// ---- fish.html ----
{
    const { ctx, els } = loadPage('fish/fish.html');
    check('功德格式化', ctx.formatMerit(9999) === '9999' && ctx.formatMerit(12345) === '1.2 万' && ctx.formatMerit(20000) === '2 万');
    ctx.resetMerit();
    check('清零', els['merit'].textContent === '0' || ctx.formatMerit(0) === '0');
    const before = parseInt(memStore['fish-merit'] || '0', 10);
    ctx.knock(null);
    check('敲击 +1 并持久化', parseInt(memStore['fish-merit'], 10) === before + 1);
}

// ---- wheel.html ----
{
    const { ctx } = loadPage('wheel/wheel.html');
    const segs = ctx.buildSegments('甲\n\n 乙 \n丙');
    check('选项解析', segs.length === 3 && segs[0].label === '甲' && segs[2].label === '丙');
    check('扇区配色', segs.every(s => /^hsl\(/.test(s.color)));
    // 指针旋转 n 个等分角，应恰好遍历所有扇区各一次
    const n = 8, seen = new Set();
    for (let k = 0; k < n; k++) seen.add(ctx.winnerIndex(k * Math.PI * 2 / n, n));
    check('winnerIndex 覆盖所有扇区', seen.size === n);
    // 一次旋转的选项再多也只规划一次，旋转数学与 n 无关
    const seqRnd = (arr) => { let i = 0; return () => arr[i++ % arr.length]; };
    const plan8 = ctx.planSpin(0, 8, seqRnd([0.3, 0.5]));
    check('planSpin 目标命中内定扇区', ctx.winnerIndex(plan8.target, 8) === plan8.winner);
    check('planSpin 只能向前', plan8.target > 0);
    const plan200 = ctx.planSpin(0, 200, seqRnd([0.999, 0]));
    check('planSpin 200 选项同数学', ctx.winnerIndex(plan200.target, 200) === plan200.winner);
    check('easeOutCubic', ctx.easeOutCubic(0) === 0 && ctx.easeOutCubic(1) === 1 && ctx.easeOutCubic(0.5) > 0.5);
}

// ---- star.html ----
{
    const stardata = fs.readFileSync(path.join(ROOT, 'star/stardata.js'), 'utf8');
    const { ctx } = loadPage('star/star.html', null, stardata);
    // 恒星时
    check('GMST at J2000', Math.abs(ctx.gmstDeg(2451545.0) - 280.4606) < 0.01);
    const j2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
    check('LST 经度叠加', Math.abs((ctx.lstDeg(j2000, 116.40) - (280.4606 + 116.40) % 360 + 360) % 360) < 0.01);
    // 赤道 → 地平：北极星过中天（高度≈纬度、正北）
    const pol = ctx.raDecToAltAz(37.955, 89.264, 39.904, 37.955);
    check('北极星高度≈纬度', Math.abs(pol.alt - 40.64) < 0.6);
    check('北极星在中天偏北', Math.min(pol.az, 360 - pol.az) < 1.5);
    // 时角 -90°（升出东方地平）
    const rise = ctx.raDecToAltAz(0, 0, 40, 270);
    check('东升西落坐标系', Math.abs(rise.alt) < 1e-6 && Math.abs(rise.az - 90) < 1e-6);
    const zen = ctx.raDecToAltAz(100, 39.904, 39.904, 100);
    check('赤纬=纬度过天顶', Math.abs(zen.alt - 90) < 1e-6);
    // 开普勒：M=0 → E=0
    check('kepler M=0', Math.abs(ctx.kepler(0, 0.1)) < 1e-9);
    // J2000 太阳位置（RA≈281°，dec≈-23°）
    const all = ctx.planetPositions(j2000);
    const sun = all.find(p => p.key === 'sun');
    check('J2000 太阳位置', Math.abs(sun.ra - 281.2) < 3 && sun.dec < -20 && sun.dec > -26);
    check('七大行星+太阳齐全', all.length === 8 && all.every(p => p.ra >= 0 && p.ra < 360 && Math.abs(p.dec) <= 90));
    // 月亮
    const m1 = ctx.moonPosition(j2000), m2 = ctx.moonPosition(j2000 + 86400000);
    const dRa = (((m2.ra - m1.ra) + 540) % 360) - 180;
    check('月亮日行约 13°', Math.abs(dRa - 13.2) < 2.5);
    check('月相参数合法', m1.age >= 0 && m1.age < 29.53 && m1.illum >= 0 && m1.illum <= 1 && Math.abs(m1.dec) <= 30);
    check('月相名称', ctx.phaseName(0.5) === '新月' && ctx.phaseName(7) === '上弦月' && ctx.phaseName(14.8) === '满月');
    // 方位
    check('八方位', ctx.directionText(0) === '北' && ctx.directionText(90) === '东' && ctx.directionText(135) === '东南' && ctx.directionText(270) === '西');
    check('方位偏角', ctx.azText(95) === '东偏南 5°' && ctx.azText(355) === '北偏西 5°' && ctx.azText(44) === '东北偏北 1°' && ctx.azText(90) === '东');
    // 3D 相机
    const vN = ctx.altAzToVec(0, 0);
    check('北地平单位向量', Math.abs(vN[0]) < 1e-12 && Math.abs(vN[1]) < 1e-12 && Math.abs(vN[2] - 1) < 1e-12);
    const vZ = ctx.altAzToVec(90, 30);
    check('天顶单位向量', Math.abs(vZ[0]) < 1e-12 && Math.abs(vZ[1] - 1) < 1e-12 && Math.abs(vZ[2]) < 1e-12);
    const vE = ctx.altAzToVec(0, 90);
    check('东地平单位向量', Math.abs(vE[0] - 1) < 1e-12 && Math.abs(vE[1]) < 1e-12 && Math.abs(vE[2]) < 1e-12);
    const camN = ctx.camBasis(0, 0);
    const prC = ctx.projectVec([0, 0, 1], camN, 1000, 800, 75);
    check('视线中心投影在画布中心', Math.abs(prC.x - 500) < 1e-9 && Math.abs(prC.y - 400) < 1e-9);
    const prE2 = ctx.projectVec(ctx.altAzToVec(30, 60), camN, 1000, 800, 75);
    check('面北时东侧在右', prE2.x > 900 && prE2.y < 400);
    const prU = ctx.projectVec(ctx.altAzToVec(60, 0), camN, 1000, 800, 75);
    check('面北时高处在上', Math.abs(prU.x - 500) < 1 && prU.y < 100);
    check('身后天体不投影', ctx.projectVec([0, 0, -1], camN, 1000, 800, 75) === null);
    const camS = ctx.camBasis(123, 45);
    const back = ctx.screenToAltAz(500, 400, camS, 1000, 800, 75);
    check('反投影回到视线方向', Math.abs(back.alt - 45) < 1e-9 && Math.abs(back.az - 123) < 1e-9);
    const vw = { yaw: 180, pitch: 10, fov: 75 };
    ctx.applyDrag(vw, 100, 50, 1000);
    check('拖动映射（右拖视角左转）', vw.yaw < 180 && vw.pitch > 10);
    const vw2 = { yaw: 0, pitch: 88, fov: 75 };
    ctx.applyDrag(vw2, 0, 1e7, 1000);
    check('俯仰夹角上界 89°', vw2.pitch === 89);
    const vw3 = { yaw: 0, pitch: -88, fov: 75 };
    ctx.applyDrag(vw3, 0, -1e7, 1000);
    check('俯仰夹角下界 -89°', vw3.pitch === -89);
    ctx.zoomFov(vw, -1000);
    check('视场夹角下界 15°', vw.fov === 15);
    ctx.zoomFov(vw, 10000);
    check('视场夹角上界 110°', vw.fov === 110);
    // 银道坐标与银河点云
    const gnp = ctx.galToEq(0, 90);
    check('银北极 RA192.86/Dec27.13', Math.abs(gnp.ra - 192.8595) < 0.05 && Math.abs(gnp.dec - 27.1284) < 0.05);
    const gc = ctx.galToEq(0, 0);
    check('银心方向 RA266.4/Dec-28.94', Math.abs(gc.ra - 266.405) < 0.05 && Math.abs(gc.dec + 28.9362) < 0.05);
    const mw = ctx.buildMilkyWay();
    check('银河点云规模', mw.length > 3500 && mw.every(p => p.ra >= 0 && p.ra < 360 && Math.abs(p.dec) <= 90 && p.a > 0 && p.a <= 0.6));
    check('银河暗带存在', mw.some(p => p.a < 0.05));
    const grid = ctx.eqGrid();
    check('赤道网格 17 条折线', grid.length === 17 && grid.every(pl => pl.pts.length > 30));
    check('黄道折线 120 点', ctx.eclipticPolyline().pts.length === 120);
    // 亮星距离表
    check('知名恒星距离表', ctx.STAR_DIST.Sirius === 8.6 && ctx.STAR_DIST.Vega === 25 && ctx.STAR_DIST.Polaris === 433);
    // 地面网格 / 天际线 / 闪烁参数 / 天空纹理
    const gg = ctx.buildGroundGrid();
    check('地面网格 24 径向 + 6 距离环', gg.radials.length === 24 && gg.rings.length === 6);
    const gv = gg.radials[0][0];
    check('地面网格向量朝地下且为单位向量', gv[1] < 0 && Math.abs(Math.hypot(gv[0], gv[1], gv[2]) - 1) < 1e-9);
    const se0 = ctx.skylineElev(10, 0), se1 = ctx.skylineElev(200, 1);
    check('天际线轮廓在地平线下', se0 < -0.5 && se0 > -3 && se1 < -0.2 && se1 > -2.5);
    check('天际线 360° 周期', Math.abs(ctx.skylineElev(10, 0) - ctx.skylineElev(370, 0)) < 1e-9);
    const tw2a = ctx.buildTwinkle(64);
    check('闪烁参数确定性且在取值域', tw2a.f1[7] >= 1.2 && tw2a.f1[7] <= 4 && tw2a.p1[7] >= 0 && tw2a.p1[7] < 6.3);
    const ns = ctx.buildNoiseStars();
    check('噪点暗星规模', ns.length === 5000 && ns.every(p => p.ra >= 0 && p.ra < 360 && Math.abs(p.dec) <= 90));
    const nb = ctx.buildNebulae();
    check('星云光斑规模与合法性', nb.length === 36 && nb.every(p => p.ra >= 0 && p.ra < 360 && Math.abs(p.dec) <= 90 && p.r > 0 && p.a > 0));
    // 星表完整性
    const SD = ctx.STAR_DATA;
    check('星表规模', SD.stars.length > 3000 && Object.keys(SD.lines).length === 88);
    check('星表坐标合法', SD.stars.every(s => s[0] >= 0 && s[0] < 360 && Math.abs(s[1]) <= 90 && s[2] > -2 && s[2] < 7));
    check('星座折线合法', Object.keys(SD.lines).every(id => {
        const c = SD.lines[id];
        return c.zh && c.anchor.length === 2 && c.polys.every(p => p.length >= 4 && p.length % 2 === 0);
    }));
    check('猎户座中文名', SD.lines.Ori && SD.lines.Ori.zh === '猎户座');
    check('亮星中文别名', SD.starZh['Sirius'] === '天狼星' && SD.starZh['Vega'] === '织女星');
    // 相机飞行（缓动 + FOV 冲刺）、星座归属匹配（悬停点亮用）
    check('缓动端点与中点', ctx.easeInOutCubic(0) === 0 && ctx.easeInOutCubic(1) === 1 &&
        Math.abs(ctx.easeInOutCubic(0.5) - 0.5) < 1e-9 && ctx.easeInOutCubic(0.25) < 0.25);
    const fl = { y0: 350, p0: 10, f0: 75, y1: 10, p1: 30, f1: 60, t0: 1000, dur: 500, punch: 8 };
    const fMid = ctx.stepFly(fl, 1250);
    check('飞行中点朝向目标一半', Math.abs(((fMid.yaw % 360) + 360) % 360 - 0) < 1e-9 &&
        Math.abs(fMid.pitch - 20) < 1e-9 && !fMid.done);
    const fIn = ctx.stepFly(fl, 1100);
    check('飞行中途 FOV 内收（冲刺感）', fIn.fov < 75 - 1 && fIn.fov > 60);
    const fEnd = ctx.stepFly(fl, 1600);
    check('飞行结束精确到位', fEnd.done && Math.abs(((fEnd.yaw % 360) + 360) % 360 - 10) < 1e-9 &&
        Math.abs(fEnd.pitch - 30) < 1e-9 && Math.abs(fEnd.fov - 60) < 1e-9);
    const nameIdx = {};
    Object.keys(SD.starNames).forEach(i => { nameIdx[SD.starNames[i]] = +i; });
    const starCon = ctx.buildStarCon(SD.stars, SD.lines);
    check('亮星归属星座可匹配', starCon[nameIdx['Betelgeuse']] === 'Ori' && starCon[nameIdx['Polaris']] === 'UMi');
}

// ---- winupdate.html ----
{
    const { ctx } = loadPage('winupdate/winupdate.html');
    const half = () => 0.5; // jitter 因子恰为 1
    const plan = ctx.buildPlan('normal', half);
    check('计划三阶段', plan.length === 3 && plan[0].label === '正在下载更新');
    check('计划时长按速度缩放', plan[0].dur === 90000 && plan[1].dur === 150000 && plan[2].dur === 240000);
    check('instant 速度缩 10 倍', ctx.buildPlan('instant', half)[0].dur === 9000);
    const p0 = ctx.progressAt(plan, 0);
    check('起点 0%', p0.stage === 0 && p0.pct === 0);
    const pMid = ctx.progressAt(plan, 45000);
    check('阶段一中点 50%', pMid.stage === 0 && pMid.pct === 50);
    const pS1 = ctx.progressAt(plan, 90000);
    check('进入阶段二', pS1.stage === 1 && pS1.pct === 0);
    const pEnd = ctx.progressAt(plan, 90000 + 150000 + 240000 + 999999);
    check('终点永远 99%', pEnd.stage === 2 && pEnd.pct === 99);
    // 单调性采样：用 阶段*100+百分比 作为全局进度（跨阶段不回落）
    let last = -1, mono = true;
    for (let t = 0; t <= 500000; t += 5000) {
        const st = ctx.progressAt(plan, t);
        const p = st.stage * 100 + st.pct;
        if (p < last) mono = false;
        last = p;
    }
    check('进度单调不减', mono);
}

// ---- fakecode.html ----
{
    const { ctx } = loadPage('fakecode/fakecode.html');
    const html = ctx.highlight('const s = "<b>x</b>"; // <i>注</i>');
    check('高亮转义 HTML', html.indexOf('<b>') === -1 && html.includes('&lt;b&gt;'));
    check('高亮分类上色', html.includes('class="kw"') && html.includes('class="str"') && html.includes('class="cm"'));
    check('高亮数字', ctx.highlight('let n = 3.14;').includes('class="num"'));
    const seq = (arr) => { let i = 0; return () => arr[i++ % arr.length]; };
    check('nextIndex 不与上次重复', ctx.nextIndex(seq([0.5, 0.1]), 5, 2) === 0);
    check('nextIndex 单元素', ctx.nextIndex(seq([0.9]), 1, 0) === 0);
    check('progressOf 递增封顶 99', ctx.progressOf(0) === 0 &&
        ctx.progressOf(50) > ctx.progressOf(10) && ctx.progressOf(100000) === 99);
}

// ---- hash.html（异步块，最后收尾） ----
(async () => {
    const nodeCrypto = require('crypto');
    const { ctx, els } = loadPage('hash/hash.html', { crypto: nodeCrypto.webcrypto, window: {} });
    check('md5 abc', ctx.md5('abc') === '900150983cd24fb0d6963f7d28e17f72');
    check('md5 空串', ctx.md5('') === 'd41d8cd98f00b204e9800998ecf8427e');
    const long = '哈希长文本测试'.repeat(200);
    check('md5 中文长文对拍', ctx.md5(long) === nodeCrypto.createHash('md5').update(long, 'utf8').digest('hex'));
    check('bufToHex', ctx.bufToHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef])) === 'deadbeef');
    const sha256 = await ctx.shaHex('SHA-256', 'abc');
    check('SHA-256 标准向量', sha256 === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const sha1 = await ctx.shaHex('SHA-1', 'abc');
    check('SHA-1 标准向量', sha1 === 'a9993e364706816aba3e25717850c26c9cd0d89d');
    const sha512 = await ctx.shaHex('SHA-512', 'abc');
    check('SHA-512 标准向量', sha512 === 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a' + '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f');
    els['input'].value = 'abc';
    await ctx.computeAndRender('abc', null);
    check('computeAndRender 渲染', els['hashResult'].innerHTML.includes('900150983cd24fb0d6963f7d28e17f72'));
    finish();
})().catch(e => { console.error(e); process.exit(1); });
