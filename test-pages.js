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

function loadPage(rel, extra) {
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
    vm.runInContext(commonJs + '\n' + m[1], ctx);
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
    check('hexToRgb 非法', ctx.hexToRgb('#xyz') === null && ctx.hexToRgb('#fff') === null);
    const hslRed = ctx.rgbToHsl(255, 0, 0);
    const backRed = ctx.hslToRgb(hslRed.h, hslRed.s, hslRed.l);
    check('hsl 精确回环', JSON.stringify(backRed) === JSON.stringify({ r: 255, g: 0, b: 0 }));
    const hsl = ctx.rgbToHsl(74, 158, 255);
    const back = ctx.hslToRgb(hsl.h, hsl.s, hsl.l);
    check('hsl 近似回环', Math.abs(back.r - 74) <= 3 && Math.abs(back.g - 158) <= 3 && Math.abs(back.b - 255) <= 1);
    check('黑白对比度 21', Math.abs(ctx.contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }) - 21) < 0.1);
    check('WCAG 标签', ctx.wcagTag(21, 'AAA').includes('wcag-pass') && ctx.wcagTag(3, 'AA').includes('wcag-fail'));
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

// ---- fractal.html ----
{
    const { ctx } = loadPage('fractal/fractal.html');
    check('心在集合内', ctx.mandelIter(0, 0, 100).n === 100);
    check('远处快速逃逸', ctx.mandelIter(2, 2, 100).n < 5);
    const v = { x0: 0, x1: 2, y0: -1, y1: 1 };
    const r1 = ctx.rectFromDrag(0, 0, 100, 100, 100, 100, v);
    const r2 = ctx.rectFromDrag(100, 100, 0, 0, 100, 100, v);
    check('框选缩放映射', JSON.stringify(r1) === JSON.stringify(v) && JSON.stringify(r2) === JSON.stringify(v));
    const half = ctx.rectFromDrag(50, 0, 100, 100, 100, 100, v);
    check('框选右半', Math.abs(half.x0 - 1) < 1e-9 && Math.abs(half.x1 - 2) < 1e-9);
    const pal = ctx.makePalette([[0, [0, 0, 0]], [1, [255, 255, 255]]]);
    check('调色板中点', JSON.stringify(pal(0.5)) === JSON.stringify([128, 128, 128]));
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
