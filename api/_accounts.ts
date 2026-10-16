// The Kaggle accounts the model server may run on. The token for each lives in a Vercel environment variable.
export interface AccountDef {
  id: string
  label: string
  env: string
  main?: boolean
}

export const ACCOUNTS: AccountDef[] = [
  { id: 'butterboy', label: 'butterboy (main)', env: 'KAGGLE_TOKEN_BUTTERBOY', main: true },
  { id: 'thanujamanjunath', label: 'thanujamanjunath', env: 'KAGGLE_TOKEN_THANUJAMANJUNATH' },
  { id: 'cs23b2005', label: 'cs23b2005', env: 'KAGGLE_TOKEN_CS23B2005' },
]

export const KERNEL_SLUG = 'filinglens-server'
export const DATASET_SLUG = 'filinglens-adapters'
