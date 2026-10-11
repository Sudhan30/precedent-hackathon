/** Change only the database path, preserving MongoDB multi-host authorities. */
export function withDatabase(uri: string, database: string): string {
  if (!/^mongodb(?:\+srv)?:\/\//.test(uri) || !/^[a-zA-Z0-9_-]+$/.test(database)) {
    throw new Error('Invalid MongoDB connection or database name');
  }
  const query = uri.indexOf('?');
  const connection = query < 0 ? uri : uri.slice(0, query);
  const options = query < 0 ? '' : uri.slice(query);
  const authorityStart = connection.indexOf('://') + 3;
  const path = connection.indexOf('/', authorityStart);
  return (path < 0 ? connection + '/' : connection.slice(0, path + 1)) + database + options;
}
