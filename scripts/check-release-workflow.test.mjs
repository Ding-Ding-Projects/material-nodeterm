import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { validateReleaseWorkflow } from './check-release-workflow.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const planner = workflow.jobs.release.steps.find((step) => step.id === 'version_plan')
assert.equal(typeof planner.run, 'string')
assert.deepEqual(validateReleaseWorkflow(workflow, packageJson), [])

const savedRun = planner.run
delete planner.run
const broken = validateReleaseWorkflow(workflow, packageJson)
assert.ok(broken.some((issue) => issue.includes('step version_plan must declare exactly one executable route')))

planner.run = savedRun
assert.deepEqual(validateReleaseWorkflow(workflow, packageJson), [])
console.log('Release workflow route mutation: RED when version_plan.run is removed, GREEN after restoration.')
