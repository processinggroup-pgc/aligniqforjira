import api, { route } from '@forge/api';

// This is called only by the authenticated AlignIQ web trigger. Its secret is
// bound to one installation; the caller also verifies the connected client ID.
// Board reads run as the installed app because no Jira browser user is present.
export async function listTeamBoards(connection, requestedProjectKey) {
  const read = async (path) => {
    const response = await api.asApp().requestJira(path, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Jira board discovery failed (${response.status}).`);
    return response.json();
  };
  let projectKey = requestedProjectKey;
  if (!projectKey && connection.boardId) {
    const board = await read(route`/rest/agile/1.0/board/${connection.boardId}`);
    projectKey = board.location?.projectKey || board.location?.projectId;
  }
  if (!projectKey) throw new Error('Connect a Jira board with a project location before choosing teams.');
  const project = await read(route`/rest/api/3/project/${projectKey}`);
  const boards = [];
  let startAt = 0;
  // Follow Jira pagination, including empty team boards. A board mentioning the
  // project in its filter can live elsewhere, so also enforce its location.
  for (;;) {
    const page = await read(route`/rest/agile/1.0/board?projectKeyOrId=${project.key}&startAt=${startAt}&maxResults=100&orderBy=name`);
    const values = page.values || [];
    boards.push(...values.filter(board => String(board.location?.projectId) === String(project.id) || board.location?.projectKey === project.key));
    startAt += values.length;
    if (page.isLast || !values.length || (Number.isFinite(page.total) && startAt >= page.total)) break;
  }
  return { projectKey: project.key, projectName: project.name, boards: boards.map(board => ({ id: board.id, name: board.name, type: board.type })) };
}
