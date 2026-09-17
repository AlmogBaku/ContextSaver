import { describe, expect, test } from 'claude-code/testing'

import { appendedTo, bulletOf, bulletOnly, mergeSettings, propose, render } from '../hooks/core/rules'
import { killPrompt } from '../hooks/core/text'
import { rulePattern } from './fixtures/rules/pattern'
import { ruleProposals } from './fixtures/rules/proposals'
import { existingSettings } from './fixtures/rules/settings'
import { ruleState } from './fixtures/rules/state'

const rule = 'Bash(bun test:*)'

describe('rules', () => {
  test('claude-md appends a bullet under the heading', async () => {
    expect(render('claude-md', ruleProposals['claude-md'], '/repo')).toEqual({
      path: '/repo/CLAUDE.md',
      content: '\n## ContextSaver\n- Run only the tests covering the files you changed; run the full suite at the end of a phase.\n',
      mode: 'append',
    })
    expect(bulletOf('Run targeted tests.')).toBe('- Run targeted tests.\n')
  })

  test('claude-md flattens a multi-line body into one bullet and never doubles the marker', async () => {
    const body = 'First rule.\nSecond rule.'
    expect(render('claude-md', { kind: 'claude-md', title: 'T', body }, '/repo').content).toBe('\n## ContextSaver\n- First rule. Second rule.\n')
    expect(render('claude-md', { kind: 'claude-md', title: 'T', body: '- Already a bullet.' }, '/repo').content).toBe('\n## ContextSaver\n- Already a bullet.\n')
  })

  test('bulletOnly returns the bullet for an append under an existing heading', async () => {
    const content = render('claude-md', ruleProposals['claude-md'], '/repo').content
    expect(bulletOnly(content)).toBe(bulletOf(ruleProposals['claude-md'].body))
    expect(bulletOnly('no bullet here')).toBe('no bullet here')
  })

  test('appendedTo lands the bullet on its own line whatever the file ends with', async () => {
    const content = render('claude-md', ruleProposals['claude-md'], '/repo').content
    const bullet = bulletOf(ruleProposals['claude-md'].body)
    expect(appendedTo('# Project\n\n## ContextSaver\n- an older rule\n', content)).toBe(`# Project\n\n## ContextSaver\n- an older rule\n${bullet}`)
    expect(appendedTo('# Project\n\n## ContextSaver\n- an older rule', content), 'a file with no trailing newline is not glued to')
      .toBe(`# Project\n\n## ContextSaver\n- an older rule\n${bullet}`)
    expect(appendedTo('# Project', content), 'a heading of its own opens on a blank line').toBe(`# Project\n\n## ContextSaver\n${bullet}`)
    expect(appendedTo(null, content), 'a brand-new file starts at the heading').toBe(`## ContextSaver\n${bullet}`)
    expect(appendedTo('', content)).toBe(`## ContextSaver\n${bullet}`)
  })

  test('skill writes a slugged SKILL.md with name and description frontmatter', async () => {
    expect(render('skill', ruleProposals.skill, '/repo')).toEqual({
      path: '/repo/.claude/skills/targeted-test-run-fast/SKILL.md',
      content: '---\nname: "targeted-test-run-fast"\ndescription: "Targeted test run: fast"\n---\n\n# Targeted tests\n\nMap the changed files to their test files, run those, then stop.\n',
      mode: 'write',
    })
  })

  test('agent-brief lifts the body model line into frontmatter and always names tools', async () => {
    expect(render('agent-brief', ruleProposals['agent-brief'], '/repo')).toEqual({
      path: '/repo/.claude/agents/log-triage-brief.md',
      content: '---\nname: "log-triage-brief"\ndescription: "Log triage brief"\nmodel: "haiku"\ntools: "Read, Grep, Glob"\n---\n\nGrep the api logs for errors and report the first failing request only.\n',
      mode: 'write',
    })
  })

  test('agent-brief omits model when the body has no model line and keeps a body tools line', async () => {
    const p = { ...ruleProposals['agent-brief'], body: 'tools: Read, Grep\n\nReport the first failing request only.' }
    const content = render('agent-brief', p, '/repo').content
    expect(content).not.toContain('model:')
    expect(content).toContain('tools: "Read, Grep"')
    expect(content).toContain('\n\nReport the first failing request only.\n')
  })

  test('agent-brief lifts only the leading block, so a prose tools line stays in the body', async () => {
    const p = { ...ruleProposals['agent-brief'], body: 'Grep the api logs.\n\ntools: only the ones you need, then stop.' }
    const content = render('agent-brief', p, '/repo').content
    expect(content).toContain('tools: "Read, Grep, Glob"')
    expect(content).toContain('\n\nGrep the api logs.\n\ntools: only the ones you need, then stop.\n')
  })

  test('settings-allow carries the rule verbatim for the merge', async () => {
    expect(render('settings-allow', ruleProposals['settings-allow'], '/repo')).toEqual({
      path: '/repo/.claude/settings.json',
      content: 'Bash(bun test:*)',
      mode: 'merge-settings',
    })
  })

  test('propose ignores undecided patterns and a kept pattern without a proposal', async () => {
    const undecided = rulePattern({})
    const withProposal = rulePattern({ id: 'execution:other', proposal: ruleProposals.skill })
    const kept = rulePattern({ id: 'execution:kept', decision: 'keep', decidedAtTurn: 9 })
    expect(propose(ruleState([undecided, withProposal, kept]))).toEqual([])
  })

  test('propose ignores a kept pattern that carries a judge proposal, because a keep is final', async () => {
    const kept = rulePattern({ decision: 'keep', decidedAtTurn: 9, proposal: ruleProposals['settings-allow'] })
    expect(propose(ruleState([kept]))).toEqual([])
  })

  test('propose turns a steer into its instruction and a kill into its scoped fix, not the kill prompt', async () => {
    const steered = rulePattern({ decision: 'steer', decidedAtTurn: 8, instruction: 'Run the full cycle only at the end of each phase.' })
    const killed = rulePattern({ id: 'reading:unfiltered-log-dump', kind: 'Claude keeps reading 2000 lines of api logs', hits: ['t3', 't4'], decision: 'kill', decidedAtTurn: 14 })
    const artifacts = propose(ruleState([steered, { ...killed, instruction: killPrompt(killed) }]))

    expect(artifacts.map(a => a.patternId)).toEqual(['reading:unfiltered-log-dump', 'execution:full-suite-after-each-edit'])
    expect(artifacts.map(a => a.kind)).toEqual(['claude-md', 'claude-md'])
    expect(artifacts.map(a => a.savingPct)).toEqual([15, 3])
    expect(artifacts[1]?.title).toBe('Running the whole bun test suite after every single-file edit')
    expect(artifacts[1]?.content).toBe('\n## ContextSaver\n- Run the full cycle only at the end of each phase.\n')
    expect(artifacts[0]?.content).toBe(`\n## ContextSaver\n- ${killed.alternative}\n`)
    expect(artifacts[0]?.content).not.toContain('for the rest of the session')
    expect(artifacts[0]?.path).toBe('/repo/CLAUDE.md')
  })

  test('propose puts a behavioural pattern with no evidence rows last, at zero saving', async () => {
    const behavioural = rulePattern({ id: 'behavior:plan-resummary', kind: 'Claude keeps re-summarising the plan', signature: null, hits: ['turn:5', 'turn:7'], estTokensPerTurn: 900, decision: 'steer', decidedAtTurn: 6, instruction: 'Do not re-summarise the plan.' })
    const steered = rulePattern({ decision: 'steer', decidedAtTurn: 8, instruction: 'Run the full cycle only at the end of each phase.' })
    expect(propose(ruleState([behavioural, steered])).map(a => [a.patternId, a.savingPct])).toEqual([
      ['execution:full-suite-after-each-edit', 3],
      ['behavior:plan-resummary', 0],
    ])
  })

  test('propose omits an artifact this session already wrote or tried', async () => {
    const steered = rulePattern({ decision: 'steer', decidedAtTurn: 8, instruction: 'Run the full cycle only at the end of each phase.' })
    const state = ruleState([steered])
    expect(propose(state)).toHaveLength(1)
    expect(propose({ ...state, written: [`${steered.id}:claude-md`] })).toEqual([])
    expect(propose({ ...state, written: [`${steered.id}:skill`] })).toHaveLength(1)   // another kind is still on offer
  })

  test('propose prefers the judge proposal of a decided pattern', async () => {
    const decided = rulePattern({ decision: 'steer', decidedAtTurn: 8, instruction: 'Anything.', proposal: ruleProposals['settings-allow'] })
    const artifacts = propose(ruleState([decided]))
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.kind).toBe('settings-allow')
    expect(artifacts[0]?.title).toBe('Allow bun test')
    expect(artifacts[0]?.mode).toBe('merge-settings')
    expect(artifacts[0]?.savingPct).toBe(3)
  })

  test('mergeSettings adds the rule once, keeps unrelated keys and stays idempotent', async () => {
    const once = mergeSettings(existingSettings, rule)
    expect(JSON.parse(once)).toEqual({
      model: 'opus',
      permissions: { deny: ['Bash(rm -rf:*)'], allow: ['Bash(git status:*)', rule] },
      env: { CONTEXTSAVER_DEBUG: '1' },
    })
    expect(once).toContain('\n  "model": "opus"')
    expect(once.endsWith('}\n')).toBe(true)
    expect(mergeSettings(once, rule)).toBe(once)
  })

  test('mergeSettings starts from an empty object for null, broken or non-object settings', async () => {
    const fresh = '{\n  "permissions": {\n    "allow": [\n      "Bash(bun test:*)"\n    ]\n  }\n}\n'
    expect(mergeSettings(null, rule)).toBe(fresh)
    expect(mergeSettings('{ "permissions": ', rule)).toBe(fresh)
    expect(mergeSettings('[1, 2]', rule)).toBe(fresh)
    expect(mergeSettings('{"permissions": {"allow": "Bash(ls:*)"}}', rule)).toBe(fresh)
  })
})
