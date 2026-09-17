// 临时验证脚本：用 Node vm + DOM stub 测试三个工具页的核心逻辑
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const commonJs = fs.readFileSync(path.join(ROOT, 'assets/common.js'), 'utf8');

function loadPage(rel) {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    if (!m) throw new Error(rel + ': no inline script found');
    const els = {};
    const listeners = {};
    function makeEl(id) {
        return {
            id, value: '', innerHTML: '', textContent: '', className: '',
            style: {}, checked: false, dataset: {},
            classList: { add() {}, remove() {}, toggle() {} },
            addEventListener(type, fn) { (listeners[id + ':' + type] = listeners[id + ':' + type] || []).push(fn); }
        };
    }
    const sandbox = {
        console,
        setTimeout() {},
        setInterval() {},
        navigator: {},
        TextEncoder, TextDecoder, Uint8Array, JSON,
        btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        document: {
            getElementById(id) { return els[id] || (els[id] = makeEl(id)); }
        }
    };
    const ctx = vm.createContext(sandbox);
    vm.runInContext(commonJs + '\n' + m[1], ctx);
    return { ctx, els, listeners };
}

let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name); }
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
    els['inputA'].value = 'a\nb\nc';
    els['inputB'].value = 'a\nx\nc';
    ctx.doDiff();
    check('并排视图渲染', els['diffResult'].innerHTML.includes('sd-row change'));
    check('行内高亮标记', els['diffResult'].innerHTML.includes('part-del') && els['diffResult'].innerHTML.includes('part-add'));
    check('diff 统计', els['diffBadge'].textContent === '+1 / -1');
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
    ctx.toggleFold(4);
    check('展开折叠段', !els['diffResult'].innerHTML.includes('展开 6 行未更改') &&
        (els['diffResult'].innerHTML.match(/sd-row same/g) || []).length === 15);
    ctx.switchView('unified');
    check('统一视图渲染', els['diffResult'].innerHTML.includes('diff-row del') && els['diffResult'].innerHTML.includes('diff-row add'));
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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
