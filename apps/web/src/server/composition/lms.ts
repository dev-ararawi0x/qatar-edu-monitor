import { CreateSolveJobs, GetJobQuestions, GetLmsConnection, MarkDraftReviewed, UpdateDraft, GetSolveJob, ResumeSolveJob, ListAssessments, ListSolveJobs, ListSubjects, RefreshAssessments, RefreshSubjects, RevokeLmsConnection, SaveLmsCredential, ValidateLmsConnection } from '@hallili/application'
import { createDatabase, DrizzleCatalogRepository, DrizzleLmsCredentialRepository, DrizzleSolveJobRepository, DrizzleDraftRepository } from '@hallili/db'
import { AesGcmCredentialCipher, FakeLmsAdapter } from '@hallili/integrations'

function requiredEnv(name: string) {
  const value = process.env[name]
  if (!value || value === 'VALUES') throw new Error(`${name} must be configured.`)
  return value
}

const database = createDatabase(requiredEnv('DATABASE_URL'))
const repository = new DrizzleLmsCredentialRepository(database.db)
const catalogRepository = new DrizzleCatalogRepository(database.db)
const solveJobRepository = new DrizzleSolveJobRepository(database.db)
const draftRepository = new DrizzleDraftRepository(database.db)
const cipher = new AesGcmCredentialCipher(requiredEnv('ENCRYPTION_KEY'))
const fakeLms = new FakeLmsAdapter(process.env.FAKE_LMS_MODE === 'expired' ? 'expired' : 'success')
const clock = { now: () => new Date() }
const ids = { uuid: () => crypto.randomUUID() }

export const lmsConnectionUseCases = {
  save: new SaveLmsCredential(repository, cipher, ids),
  get: new GetLmsConnection(repository),
  revoke: new RevokeLmsConnection(repository, clock),
  validate: new ValidateLmsConnection(repository, cipher, fakeLms, clock),
}

export const catalogUseCases = {
  listSubjects: new ListSubjects(catalogRepository),
  refreshSubjects: new RefreshSubjects(catalogRepository, repository, cipher, fakeLms, clock),
  listAssessments: new ListAssessments(catalogRepository),
  refreshAssessments: new RefreshAssessments(catalogRepository, repository, cipher, fakeLms, clock),
}

export const solvingUseCases = {
  create: new CreateSolveJobs(solveJobRepository, clock),
  list: new ListSolveJobs(solveJobRepository),
  get: new GetSolveJob(solveJobRepository),
  resume: new ResumeSolveJob(solveJobRepository, repository, clock),
}

export const draftUseCases = {
  questions: new GetJobQuestions(draftRepository),
  update: new UpdateDraft(draftRepository, clock),
  review: new MarkDraftReviewed(draftRepository, clock),
}
