/**
 * The one place the Lab imports the real motion primitives from.
 * apps/web-host does not yet declare `@squad/village` as a dependency (and its node_modules has no
 * link), so this resolves by relative path. When web-host adds `"@squad/village": "workspace:*"`,
 * change this single line to `export * from '@squad/village/motion';`.
 */
export * from '@squad/village/motion';
