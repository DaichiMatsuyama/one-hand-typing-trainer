const variants = (prefix, texts) => texts.map((text, index) => ({ id: `${prefix}-${index + 1}`, text }))

export const MESSAGE_GROUPS = Object.freeze({
  s: variants('s', ['最高ランクS、お見事です！', 'ノーミスの速さが光っています！', 'Sランク達成、すばらしい集中力です！']),
  rankUp: variants('rank-up', ['ランクアップ！積み重ねが形になりました。', '前回より一段上へ。いい伸びです！', '新しいランクに到達しました！']),
  personalBest: variants('best', ['自己ベスト更新！一歩ずつ速くなっています。', 'これまでで一番の記録です！', '自己ベストを塗り替えました！']),
  firstPractice: variants('first', ['最初の記録ができました。ここから育てていきましょう！', 'はじめの一歩、おつかれさまでした！', '初回の練習完了。自分のペースで続けましょう！']),
  accuracyUp: variants('accuracy', ['正確さが前回より伸びました！', 'ていねいな入力が成果に出ています。', '正解率アップ、その調子です！']),
  speedUp: variants('speed', ['入力速度が前回より伸びました！', '指の動きが少しずつ速くなっています。', 'スピードアップを記録しました！']),
  weakKey: variants('weak', ['苦手キーが見えてきました。次の伸びどころです！', '練習ポイントを発見できました！', '苦手が分かれば、上達への近道になります。']),
  ended: variants('ended', ['ここまでの練習も、しっかり積み重なっています。', '途中まででも大丈夫。また続きから伸ばせます！', 'ひと休みして、次は最後まで挑戦してみましょう！']),
  generalS: variants('general-s', ['すばらしい仕上がりです！', '最高ランクの力を発揮できました！', '速さと正確さがそろっています！']),
  generalA: variants('general-a', ['とても良い記録です。Sランクも見えてきました！', '速さも正確さも好調です！', '高い集中力で入力できています！']),
  generalB: variants('general-b', ['いい調子です。次のランクを目指せます！', '安定した入力ができています！', '着実に力がついています！']),
  generalC: variants('general-c', ['順調です。正確さを意識して続けましょう！', '練習の成果が記録に表れています！', 'このペースで少しずつ伸ばしましょう！']),
  generalD: variants('general-d', ['いい練習になりました。焦らず続けましょう！', 'キーの位置が少しずつ身についています！', 'ていねいな一打が次のランクにつながります！']),
  generalE: variants('general-e', ['記録を重ねるほど指が覚えていきます！', '自分のペースで続ければ大丈夫です！', '今日の一歩が上達につながっています！']),
  generalF: variants('general-f', ['ここからスタート。伸びしろがたくさんあります！', 'まずはゆっくり、正しいキーを覚えていきましょう！', '練習を始めたことが大切な一歩です！']),
  generalFree: variants('general-free', ['今日の練習、おつかれさまでした！', '自分のペースでしっかり練習できました！', '一打ずつの積み重ねが上達につながります！']),
})

function chooseGroup(context) {
  if (context.rank === 'S') return MESSAGE_GROUPS.s
  if (context.rankUp) return MESSAGE_GROUPS.rankUp
  if (context.personalBest?.isNewBest) return MESSAGE_GROUPS.personalBest
  if (context.isFirstPractice) return MESSAGE_GROUPS.firstPractice
  if (context.growth?.improvements?.some(({ type }) => type === 'accuracy')) return MESSAGE_GROUPS.accuracyUp
  if (context.growth?.improvements?.some(({ type }) => type === 'kpm')) return MESSAGE_GROUPS.speedUp
  if ((context.weakKeys?.length ?? 0) > 0) return MESSAGE_GROUPS.weakKey
  if (context.endedEarly) return MESSAGE_GROUPS.ended
  return MESSAGE_GROUPS[`general${context.rank ?? 'Free'}`] ?? MESSAGE_GROUPS.generalFree
}

export function selectMessage(context, random = Math.random) {
  const group = chooseGroup(context)
  const choices = group.filter(({ id }) => id !== context.previousMessageId)
  const available = choices.length > 0 ? choices : group
  const sampled = random()
  const value = Number.isFinite(sampled) ? sampled : 0
  const index = Math.min(available.length - 1, Math.max(0, Math.floor(value * available.length)))
  return available[index]
}
