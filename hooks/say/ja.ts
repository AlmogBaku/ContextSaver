/**
 * ContextSaver の日本語。
 *
 * 言語ファイルは訳した鍵だけを持ち、それ以外は持ちません。型は `PartialTexts` なので、
 * 抜けた分は一行ずつ英語に戻り、綴りを間違えた鍵は画面の空白ではなくコンパイルエラーに
 * なります。
 *
 * 打ち込むものは訳しません。コマンド名もそのサブコマンド（`check`、`fix`、`ignore`、
 * `debug`、`reset`）も、モデルと保存先のあいだを往復する識別子 —— `id` の中の分類、
 * 証拠の参照、シグネチャ —— もそのままです。変わるのは読むところだけです。
 *
 * 端末では全角一文字が二桁分を占めるので、ラベルは短く保ちます。パネルの見出し列は
 * 十桁しかありません（`context` に「文脈」を当てているのはそのためです）。
 */

import type { PartialTexts } from './en'

/**
 * 日本語。
 */
export const JA: PartialTexts = {
  pane: {
    awaiting: '最初のターンを待機中',
    contextUsed: share => `文脈の ${share}`,
    toCompaction: tokens => `圧縮まで ${tokens} トークン`,
    toCompactionShort: tokens => `圧縮まで ${tokens}`,
    turnsLeft: turns => `約 ${turns} ターン`,

    judge: '監査 ',
    judgeRuns: runs => `${runs} 回`,
    judgeTokens: amount => `${amount} トークン`,

    saved: '節約 ',
    checkNow: '点検',
    checking: '点検中…',
    checkingLong: 'このセッションを点検中…通常 10–20 秒',

    time: '時間',
    context: '文脈',
    timeLead: 'ツール内',
    contextLead: 'ツール由来',
    nothingYet: 'まだ目立つものはありません',

    empty: '静かに監視中。まだ繰り返しはありません。',

    fix: '修正',
    fixNote: '修正…',
    ignore: '無視',
    info: 'i',

    hits: times => `${times}×`,
    costShare: percent => `文脈の ~${percent}%`,
    turnAt: turn => `ターン ${turn}`,
    turnRange: (first, last) => `ターン ${first}–${last}`,
    // 英語はどちらも “ignored” と言います。自分で片づけたカードと、Claude が従わなかった
    // 指示です。日本語はフランス語やドイツ語と同じく、この二つを分けます。
    ignored: kind => `未適用 · ${kind}`,

    why: '理由',
    fixLabel: '修正',
    callCount: calls => `${calls} 回の呼び出し`,
    turnCount: turns => `${turns} ターン`,
    agentCount: agents => `${agents} エージェント`,
    perTurn: tokens => `1 ターンあたり ~${tokens} トークン`,
    charsOfContext: chars => `${chars} 文字の文脈`,

    turnCell: turn => `ターン ${turn}`,
    charsUnit: ' 文字',
    answerSize: chars => `${chars} の応答`,
    loop: 'エージェント',
    loopCost: (ktokens, edits) => `${ktokens}k トークン · ${edits} 件の編集`,

    steerHint: 'Enter で送信 · 修正… で閉じる · または /saver fix <n> <テキスト>',
    send: '送信',

    decided: '決定済み',
    decidedWord: { keep: '無視', steer: 'メモ付きで修正', kill: '修正' },
    savedCredit: percent => `~${percent}% 節約`,
    perRepeat: percent => `繰り返しごとに ~${percent}%`,
    ignoredTimes: times => `未適用 ${times}×`,

    rules: '次のセッション用のルール',
    artifact: {
      'claude-md': 'CLAUDE.md',
      skill: 'skill',
      'agent-brief': 'エージェント指示書',
      'settings-allow': '権限ルール',
    },
    write: '書き込む',
    tryOnce: '試す',
    skip: '見送る',

    decidedCount: decided => `決定 ${decided}`,
    rulesCount: rules => `ルール ${rules}`,
    fullPane: '/saver で全体パネル',

    verbsHint: '/saver fix|ignore <n>',
    keysFocus: 'ctrl+x tab でこのパネルにキーボードを渡す',
    keysMove: 'Tab で移動',
    keysPress: 'Enter で押す',
    keysBack: 'Esc でキーボードを返す',
  },

  band: {
    died: how => `前のターンは${how}で終了しました`,
    diedError: 'API エラー',
    diedRefusal: '拒否',
    diedContinue: '何か入力すると続行します',

    checking: 'このセッションを点検中…',

    foundWorthLook: cards => `見るべき点が ${cards} 件`,
    foundSavingBoth: (cards, share, time) => `${share} と ${time} を節約できる方法が ${cards} 件`,
    foundSaving: (cards, saving) => `${saving} を節約できる方法が ${cards} 件`,
    foundShort: cards => `無駄を ${cards} 件検出`,
    costShare: percent => `${percent >= 1 ? `~${Math.round(percent)}%` : '1% 未満'}の文脈`,

    saved: '節約 ',
    ofContext: ' の文脈',
    thisSession: '（今セッション）',

    running: '実行中',
    agentCount: agents => `${agents} エージェント`,
    callCount: calls => `${calls} 回の呼び出し`,

    watching: '監視中',
    watched: calls => `${calls} 回の呼び出しを監視`,
    quiet: 'まだ無駄はありません',

    open: '開く',
    close: '閉じる',
  },

  command: {
    description: 'ContextSaver: パネルの表示切替 · check | fix [n] [テキスト] | ignore <n> | debug | reset',
    argumentHint: '[check | fix [n] [テキスト] | ignore <n> | debug | reset]',

    usage: '使い方: /saver [check | fix [n] [テキスト] | ignore <n> | debug | reset]',
    fixUsage: '使い方: /saver fix [n] [指示]（先頭の数字はパネルが振ったカード番号。数字がなければ修正…欄が開いているカード、なければカード 1）',
    paneShown: 'ContextSaver パネルを表示しました',
    paneHidden: 'ContextSaver パネルを隠しました',
    nothingToDecide: 'ContextSaver: 決めるものはありません',
    reset: 'ContextSaver: セッションの状態をリセットしました',
    demoLoaded: 'ContextSaver: デモ用カードを読み込みました',

    checking: 'ContextSaver: このセッションの無駄を点検しています…',
    alreadyChecking: 'ContextSaver: すでに点検中です',
    nothingNew: 'ContextSaver: 新しいものはありません',
    found: cards => `ContextSaver: 新しい無駄が ${cards} 件`,
    checkFailed: failure => `ContextSaver: 点検に失敗しました — ${failure}`,
    notCheckedYet: failure => `ContextSaver: まだ点検できていません — ${failure}`,

    card: (seat, kind, outcome) => `ContextSaver: カード ${seat} —「${kind}」· ${outcome}`,
    noCard: (seat, cards) => `ContextSaver: カード ${seat} はありません（1–${cards}）`,
    outcomeIgnored: '無視しました',
    outcomeFixed: '修正しました',
    outcomeNoted: text => `あなたのメモで修正しました: ${text}`,

    toastIgnored: kind => `ContextSaver:「${kind}」を無視しました`,
    toastFixed: alternative => `ContextSaver: 修正しました — ${alternative}`,
    toastNoted: instruction => `ContextSaver: あなたのメモで修正しました — ${instruction}`,
    writeFirst: 'ContextSaver: まず指示を書いてください',

    savedToast: figures => `${figures} の文脈を節約しました`,

    wrote: path => `${path} を書き込みました`,
    trying: title => `今セッションで「${title}」を試します`,

    composerHasKeys: seat => `ContextSaver: 入力欄がキーボードを持っています — /saver fix ${seat} <あなたのメモ> と入力してください`,
  },

  categories: {
    execution: '実行',
    reading: '読み取り',
    production: '生成',
    behavior: 'ふるまい',
    communication: '伝達',
    'multi-agent': 'マルチエージェント',
    environment: '環境',
    process: 'プロセス',
    other: 'その他',
  },

  judge: {
    // わざと英語で書いています。英語のプロンプトの末尾に足す一段落で、読むのはモデルだけです。
    // 周りのプロンプトと同じ言語で書いた指示がいちばん守られます。求めている中身のほうが日本語です。
    directive: `## Language — write the reply's prose in Japanese
The rules and the blocks above are in English because that is this prompt's language; your reply's prose is not. Write \`kind\`, \`why\`, \`alternative\`, \`time\`, \`context\` and any \`proposal\` \`title\` and \`body\` in Japanese, in the plain words of the work, and keep the brevity the caps ask for — they count characters, and a Japanese character says more than a Latin one, so the sentences should be shorter still. \`kind\` starts exactly with \`Claude は繰り返し\` in place of \`Claude keeps \` — one space after \`Claude\`, none after \`繰り返し\` — and carries on to the verb at the end, as in \`Claude は繰り返し単一ファイルの編集ごとにテストスイート全体を実行しています\`: the examples above show the English opening because they were written for it.
Everything a machine matches is never translated and stays exactly as specified above: the JSON keys, the \`id\` and its kebab slug, the nine \`category\` names, the evidence handles (\`r12\`, \`turn:7\`, \`agent:a3\`), the \`signature\` \`tool\` and \`key\` copied character-for-character from a LEDGER row, and the \`proposal\` \`kind\`. A translated one discards the finding whole.`,
    kindPrefix: 'Claude は繰り返し',
    instruction: text => `ユーザーからの指示（ContextSaver 経由）: ${text}`,
    kill: (kind, alternative) => `このセッションの残りはこのふるまいをやめてください: ${kind}。今後は: ${alternative}`,
  },

  config: {
    languageLabel: '言語',
    languageAvailable: tags => `利用できる言語: ${tags.join('、')}`,
  },
}
