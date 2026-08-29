import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { validateReleaseWorkflow } from './check-release-workflow.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
describe('release workflow contract', () => {
  it('accepts the checked-in workflow and catches a removed executable route', () => {
    const planner = workflow.jobs.release.steps.find((step) => step.id === 'version_plan')
    expect(typeof planner.run).toBe('string')
    expect(validateReleaseWorkflow(workflow, packageJson)).toEqual([])

    const savedRun = planner.run
    delete planner.run
    const broken = validateReleaseWorkflow(workflow, packageJson)
    expect(broken.some((issue) => issue.includes('step version_plan must declare exactly one executable route'))).toBe(true)

    planner.run = savedRun
    expect(validateReleaseWorkflow(workflow, packageJson)).toEqual([])
  })
})
