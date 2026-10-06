/** Who you are on a board: shown next to your cursor and on what you create. */
export interface Identity {
  /** Account id, so comments and votes know whose they are. */
  id: string
  name: string
  color: string
}
