/**
 * Runs work atomically across repositories.
 *
 * `R` is the set of repositories a use case needs. Use cases declare only the subset they
 * use (e.g. `UnitOfWork<{ members: MemberRepository }>`), and the infrastructure unit of
 * work, which provides every repository, satisfies them all.
 */
export interface UnitOfWork<R> {
  /** Repositories outside any transaction, for plain reads and single writes. */
  readonly repos: R;
  /** Runs `work` in one transaction; repositories passed to it share that transaction. */
  transaction<T>(work: (repos: R) => Promise<T>): Promise<T>;
}
