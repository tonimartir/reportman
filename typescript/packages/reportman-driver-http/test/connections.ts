// The connections file (dbxconnections.ini) of a test run: a section per report connection of the test
// reports, all of them pointing at the mock Hub of the run (never at the real one), so both engines read the
// same Hub database, credentials and URL from it.

import { AUTH, EXAMPLE_DB, PRIVATE_DB } from './hub.ts';

/** The connections file for the mock Hub at `hubUrl`; `refusedUrl` is an address nobody listens on. */
export function connectionsIni(hubUrl: string, refusedUrl: string): string {
  const agent = 'DriverName=Reportman AI Agent';
  const sections: Record<string, string[]> = {
    SAMPLES: [agent, 'Url=' + hubUrl, 'HubDatabaseId=' + EXAMPLE_DB],
    AGENT: [agent, 'Url=' + hubUrl, 'HubDatabaseId=' + EXAMPLE_DB],
    MAPPED: [agent, 'Url=' + hubUrl, 'HubDatabaseId=' + EXAMPLE_DB],
    PRIVATE_KEY: [agent, 'Url=' + hubUrl, 'HubDatabaseId=' + PRIVATE_DB, 'ApiKey=' + AUTH.apiKey, 'Token=ignored-with-a-key'],
    PRIVATE_NOKEY: [agent, 'Url=' + hubUrl, 'HubDatabaseId=' + PRIVATE_DB],
    PRIVATE_BADKEY: [agent, 'Url=' + hubUrl, 'HubDatabaseId=' + PRIVATE_DB, 'ApiKey=not-the-key'],
    PRIVATE_TOKEN: [agent, 'Url=' + hubUrl, 'HubDatabaseId=' + PRIVATE_DB, 'Token=' + AUTH.token],
    NOID: [agent, 'Url=' + hubUrl],
    BADID: [agent, 'Url=' + hubUrl, 'HubDatabaseId=seven'],
    ZEROID: [agent, 'Url=' + hubUrl, 'HubDatabaseId=0'],
    UNKNOWNDB: [agent, 'Url=' + hubUrl, 'HubDatabaseId=99'],
    REFUSED: [agent, 'Url=' + refusedUrl, 'HubDatabaseId=' + EXAMPLE_DB],
    TRAILING: [agent, 'Url = ' + hubUrl + '///', '  HubDatabaseId =  ' + EXAMPLE_DB + '  '],
    BASEURLKEY: ['drivername=Reportman Agent', '; a comment', 'httpagentbaseurl=' + hubUrl, 'hubdatabaseid=' + EXAMPLE_DB, 'apikey='],
  };
  const lines: string[] = ['; The connections of the tests of reportman-driver-http'];
  for (const [name, keys] of Object.entries(sections)) lines.push('', '[' + name + ']', ...keys);
  return lines.join('\r\n') + '\r\n';
}
