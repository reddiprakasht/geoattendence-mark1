import { requestSheetsApi } from './sheetsApi.js';

export async function authenticateUser(punchingNumber, password) {
  const user = await requestSheetsApi({ action: 'login', punchingNumber, password });
  if (
    !user ||
    typeof user.name !== 'string' ||
    !['worker', 'admin'].includes(user.role) ||
    typeof user.sessionToken !== 'string'
  ) {
    throw new Error('The sign-in response was invalid. Contact your administrator.');
  }
  return user;
}
