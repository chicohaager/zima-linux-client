import { app } from 'electron'

const version = app.getVersion()

const isAlpha = version.includes('alpha')
const isBeta = version.includes('beta')
const isTesting = isAlpha || isBeta
const isLatest = !isAlpha && !isBeta
const currentPhase = isAlpha ? 'alpha' : isBeta ? 'beta' : 'latest'

export {
  currentPhase,
  isAlpha,
  isBeta,
  isLatest,
  isTesting,
}
