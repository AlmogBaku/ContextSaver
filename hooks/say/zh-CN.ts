/**
 * ContextSaver 简体中文。
 *
 * 语言文件只带它翻译过的键，不带别的：它的类型是 `PartialTexts`，没写的部分会逐行
 * 回退到英文，拼错的键是编译错误，而不是屏幕上的一处空白。
 *
 * 要敲的东西不翻译：命令名和它的子命令（`check`、`fix`、`ignore`、`debug`、`reset`）
 * 不变，模型与存储之间往返的标识符也不变 —— `id` 里的类别、证据句柄、签名。只有要读的
 * 部分会变。
 *
 * 一个汉字在终端里占两格，所以这里的标签要短：面板的标签栏只有十格宽。
 */

import type { PartialTexts } from './en'

/**
 * 简体中文。
 */
export const ZH_CN: PartialTexts = {
  pane: {
    awaiting: '等待第一轮',
    contextUsed: share => `已用 ${share} 上下文`,
    toCompaction: tokens => `距压缩还有 ${tokens} tokens`,
    toCompactionShort: tokens => `距压缩 ${tokens}`,
    turnsLeft: turns => `约 ${turns} 轮`,

    judge: '审计 ',
    judgeRuns: runs => `${runs} 次`,
    judgeTokens: amount => `${amount} tokens`,

    saved: '已省 ',
    checkNow: '检查',
    checking: '检查中…',
    checkingLong: '正在检查本次会话…通常 10–20 秒',

    time: '时间',
    context: '上下文',
    timeLead: '在工具中',
    contextLead: '来自工具',
    nothingYet: '暂无明显问题',

    empty: '静默监视中。暂未发现重复。',

    fix: '修正',
    fixNote: '修正…',
    ignore: '忽略',
    info: 'i',

    hits: times => `${times}×`,
    costShare: percent => `~${percent}% 上下文`,
    turnAt: turn => `第 ${turn} 轮`,
    turnRange: (first, last) => `第 ${first}–${last} 轮`,
    // 英文两处都说 “ignored”：一处是你自己划掉的卡片，一处是 Claude 没照做的指令。
    // 中文把两者分开，跟法语和德语一样。
    ignored: kind => `未采纳 · ${kind}`,

    why: '原因',
    fixLabel: '修正',
    callCount: calls => `${calls} 次调用`,
    turnCount: turns => `${turns} 轮`,
    agentCount: agents => `${agents} 个代理`,
    perTurn: tokens => `每轮约 ${tokens} tokens`,
    charsOfContext: chars => `${chars} 字符上下文`,

    turnCell: turn => `第 ${turn} 轮`,
    charsUnit: ' 字符',
    answerSize: chars => `${chars} 回复`,
    loop: '代理',
    loopCost: (ktokens, edits) => `${ktokens}k tokens · ${edits} 次编辑`,

    steerHint: 'Enter 发送 · 再按修正… 关闭 · 或 /saver fix <n> <文本>',
    send: '发送',

    decided: '已决定',
    decidedWord: { keep: '已忽略', steer: '已按备注修正', kill: '已修正' },
    savedCredit: percent => `已省 ~${percent}%`,
    perRepeat: percent => `每次重复 ~${percent}%`,
    ignoredTimes: times => `未采纳 ${times}×`,

    rules: '下次会话的规则',
    artifact: {
      'claude-md': 'CLAUDE.md',
      skill: 'skill',
      'agent-brief': '代理简介',
      'settings-allow': '权限规则',
    },
    write: '写入',
    tryOnce: '试用',
    skip: '跳过',

    decidedCount: decided => `已决定 ${decided}`,
    rulesCount: rules => `规则 ${rules}`,
    fullPane: '/saver 打开完整面板',

    verbsHint: '/saver fix|ignore <n>',
    keysFocus: 'ctrl+x tab 将键盘交给本面板',
    keysMove: 'Tab 切换',
    keysPress: 'Enter 按下',
    keysBack: 'Esc 交还键盘',
  },

  band: {
    died: how => `上一轮以${how}结束`,
    diedError: 'API 错误',
    diedRefusal: '拒绝',
    diedContinue: '输入任意内容继续',

    checking: '正在检查本次会话…',

    foundWorthLook: cards => `发现 ${cards} 处值得一看`,
    foundSavingBoth: (cards, share, time) => `发现 ${cards} 处可省 ${share} 和 ${time}`,
    foundSaving: (cards, saving) => `发现 ${cards} 处可省 ${saving}`,
    foundShort: cards => `发现 ${cards} 处浪费`,
    costShare: percent => `${percent >= 1 ? `~${Math.round(percent)}%` : '不足 1%'}的上下文`,

    saved: '已省 ',
    ofContext: ' 上下文',
    thisSession: '（本次会话）',

    running: '运行中',
    agentCount: agents => `${agents} 个代理`,
    callCount: calls => `${calls} 次调用`,

    watching: '监视中',
    watched: calls => `已监视 ${calls} 次调用`,
    quiet: '暂无浪费',

    open: '打开',
    close: '关闭',
  },

  command: {
    description: 'ContextSaver：显示或隐藏面板 · check | fix [n] [文本] | ignore <n> | debug | reset',
    argumentHint: '[check | fix [n] [文本] | ignore <n> | debug | reset]',

    usage: '用法：/saver [check | fix [n] [文本] | ignore <n> | debug | reset]',
    fixUsage: '用法：/saver fix [n] [指令]（开头的数字指面板编号的卡片；不带数字时取修正…输入框已打开的卡片，否则取第 1 张）',
    paneShown: 'ContextSaver 面板已显示',
    paneHidden: 'ContextSaver 面板已隐藏',
    nothingToDecide: 'ContextSaver：没有待决定的项',
    reset: 'ContextSaver：会话状态已重置',
    demoLoaded: 'ContextSaver：已载入演示卡片',

    checking: 'ContextSaver：正在检查本次会话的浪费…',
    alreadyChecking: 'ContextSaver：已在检查中',
    nothingNew: 'ContextSaver：没有新发现',
    found: cards => `ContextSaver：发现 ${cards} 处新浪费`,
    checkFailed: failure => `ContextSaver：检查失败 — ${failure}`,
    notCheckedYet: failure => `ContextSaver：暂时无法检查 — ${failure}`,

    card: (seat, kind, outcome) => `ContextSaver：卡片 ${seat} —「${kind}」· ${outcome}`,
    noCard: (seat, cards) => `ContextSaver：没有第 ${seat} 张卡片（1–${cards}）`,
    outcomeIgnored: '已忽略',
    outcomeFixed: '已修正',
    outcomeNoted: text => `已按你的备注修正：${text}`,

    toastIgnored: kind => `ContextSaver：已忽略「${kind}」`,
    toastFixed: alternative => `ContextSaver：已修正 — ${alternative}`,
    toastNoted: instruction => `ContextSaver：已按你的备注修正 — ${instruction}`,
    writeFirst: 'ContextSaver：请先写下指令',

    savedToast: figures => `节省了 ${figures} 上下文`,

    wrote: path => `已写入 ${path}`,
    trying: title => `本次会话试用「${title}」`,

    composerHasKeys: seat => `ContextSaver：键盘在输入框中 — 请输入 /saver fix ${seat} <你的备注>`,
  },

  categories: {
    execution: '执行',
    reading: '读取',
    production: '产出',
    behavior: '行为',
    communication: '沟通',
    'multi-agent': '多代理',
    environment: '环境',
    process: '流程',
    other: '其他',
  },

  judge: {
    // 故意用英文写：这是接在英文 prompt 末尾的一段，只给模型看。用 prompt 自己的语言写的
    // 指令最容易被照做；它要求的内容，才是中文。
    directive: `## Language — write the reply's prose in Simplified Chinese
The rules and the blocks above are in English because that is this prompt's language; your reply's prose is not. Write \`kind\`, \`why\`, \`alternative\`, \`time\`, \`context\` and any \`proposal\` \`title\` and \`body\` in Simplified Chinese, in the plain words of the work, and keep the brevity the caps ask for — they count characters, and a Chinese character says more than a Latin one, so the sentences should be shorter still. \`kind\` starts exactly with \`Claude 反复\` in place of \`Claude keeps \` — one space after \`Claude\`, none after \`反复\`, as in \`Claude 反复在每次单文件编辑后运行整个测试套件\`: the examples above show the English opening because they were written for it.
Everything a machine matches is never translated and stays exactly as specified above: the JSON keys, the \`id\` and its kebab slug, the nine \`category\` names, the evidence handles (\`r12\`, \`turn:7\`, \`agent:a3\`), the \`signature\` \`tool\` and \`key\` copied character-for-character from a LEDGER row, and the \`proposal\` \`kind\`. A translated one discards the finding whole.`,
    kindPrefix: 'Claude 反复',
    instruction: text => `用户指令（经由 ContextSaver）：${text}`,
    kill: (kind, alternative) => `本次会话剩余时间内停止此行为：${kind}。从现在起：${alternative}`,
  },

  config: {
    languageLabel: '语言',
    languageAvailable: tags => `可用：${tags.join('、')}。`,
  },
}
