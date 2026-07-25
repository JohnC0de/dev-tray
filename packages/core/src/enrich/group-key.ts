export function computeGroupKey(
  gitRoot: string | null,
  projectName: string,
): string {
  return gitRoot ?? projectName;
}
