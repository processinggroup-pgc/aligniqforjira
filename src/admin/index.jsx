import * as React from 'react';
import ForgeReconciler, {
  Button,
  Heading,
  HelperMessage,
  Inline,
  Label,
  Lozenge,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Text,
  Textfield,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const DEFAULT_PLANFORGE_URL = 'https://aligniq-velopde.vercel.app';
const { useEffect, useState } = React;

const Settings = () => {
  const [connection, setConnection] = useState(null);
  const [baseUrl, setBaseUrl] = useState(DEFAULT_PLANFORGE_URL);
  const [clientId, setClientId] = useState('');
  const [token, setToken] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [boards, setBoards] = useState([]);
  const [board, setBoard] = useState(null);
  const [teamName, setTeamName] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  const loadBoards = () => invoke('listBoards').then((rows) => { setBoards(rows); const selected = rows.find((row) => row.id === connection?.boardId); if (selected) setBoard({ label: selected.name, value: selected.id }); }).catch((loadError) => setError(loadError.message || 'Jira boards could not be loaded.'));

  useEffect(() => {
    invoke('getConnection')
      .then((result) => {
        setConnection(result);
        if (result.baseUrl) setBaseUrl(result.baseUrl);
        if (result.clientId) setClientId(result.clientId);
        if (result.connected) invoke('listBoards').then((rows) => { setBoards(rows); const selected=rows.find((row)=>row.id===result.boardId); if(selected)setBoard({label:selected.name,value:selected.id}); }).catch(()=>{});
      })
      .catch(() => setError('The AlignIQ connection status could not be loaded.'))
      .finally(() => setIsLoading(false));
  }, []);

  const save = async () => {
    setIsSaving(true);
    setMessage('');
    setError('');
    try {
      const result = await invoke('saveConnection', { baseUrl, clientId, token });
      setConnection(result);
      setToken('');
      setMessage('AlignIQ is connected. New Jira issue-link events will synchronize automatically.');
    } catch (saveError) {
      setError(saveError.message || 'AlignIQ could not be connected.');
    } finally {
      setIsSaving(false);
    }
  };

  const importBoard = async () => {
    setIsImporting(true);setError('');setMessage('');
    try { const result=await invoke('selectBoard',{boardId:board?.value,teamName:teamName.trim()||board?.label}); setConnection(result.connection); setMessage(`${result.connection.boardName} is selected. ${result.imported} Jira issues and ${result.historyEvents||0} status transitions were imported into AlignIQ.`); setBoard(null);setTeamName(''); }
    catch(importError){setError(importError.message||'The Jira board could not be imported.')} finally{setIsImporting(false)}
  };

  const disconnect = async () => {
    setIsSaving(true);
    setMessage('');
    setError('');
    try {
      const result = await invoke('disconnectConnection');
      setConnection(result);
      setToken('');
      setMessage('AlignIQ synchronization is disconnected. Jira-only features remain available.');
    } catch (disconnectError) {
      setError(disconnectError.message || 'AlignIQ could not be disconnected.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Stack alignInline="center" space="space.100">
        <Spinner size="medium" />
        <Text>Loading AlignIQ settings…</Text>
      </Stack>
    );
  }

  return (
    <Stack space="space.300">
      <Stack space="space.100">
        <Inline alignBlock="center" spread="space-between" space="space.200">
          <Heading size="large">AlignIQ connection</Heading>
          <Lozenge appearance={connection?.connected ? 'success' : 'default'}>
            {connection?.connected ? 'Connected' : 'Jira-only mode'}
          </Lozenge>
        </Inline>
        <Text>
          Connect this Jira site to one AlignIQ client. The issue panel remains
          available even when synchronization is disabled.
        </Text>
      </Stack>

      {message ? (
        <SectionMessage appearance="success" title="Connection updated">
          <Text>{message}</Text>
        </SectionMessage>
      ) : null}
      {error ? (
        <SectionMessage appearance="error" title="Connection not updated">
          <Text>{error}</Text>
        </SectionMessage>
      ) : null}
      {connection?.lastError ? (
        <SectionMessage appearance="warning" title="Last synchronization failed">
          <Text>{connection.lastError}</Text>
        </SectionMessage>
      ) : null}

      <Stack space="space.150">
        <Label labelFor="planforge-url">AlignIQ URL</Label>
        <Textfield
          id="planforge-url"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          isDisabled={isSaving}
        />
        <Label labelFor="planforge-client-id">AlignIQ client ID</Label>
        <Textfield
          id="planforge-client-id"
          placeholder="todyl"
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          isDisabled={isSaving}
        />
        <Label labelFor="planforge-token">
          {connection?.connected ? 'New connection token' : 'One-time connection token'}
        </Label>
        <Textfield
          id="planforge-token"
          type="password"
          placeholder="pfi_…"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          isDisabled={isSaving}
        />
        <HelperMessage>
          Generate this token in AlignIQ Admin → Integrations. It is encrypted
          in Atlassian storage and never returned to this page.
        </HelperMessage>
      </Stack>

      <Inline space="space.100">
        <Button
          appearance="primary"
          isDisabled={isSaving || !clientId.trim() || !token.trim()}
          onClick={save}
        >
          {isSaving ? 'Connecting…' : connection?.connected ? 'Reconnect' : 'Connect AlignIQ'}
        </Button>
        {connection?.connected ? (
          <Button appearance="danger" isDisabled={isSaving} onClick={disconnect}>
            Disconnect
          </Button>
        ) : null}
      </Inline>

      {connection?.connected ? (
        <SectionMessage appearance="information" title="Connected Jira site">
          <Text>{connection.siteUrl}</Text>
          <Text>
            Last event: {connection.lastEventAt || 'Waiting for the first issue-link change'}
          </Text>
        </SectionMessage>
      ) : null}
      {connection?.connected ? <Stack space="space.150"><Heading size="medium">Planning boards</Heading><Text>Add each Jira Software board that should feed AlignIQ. Assign the delivery-team name people expect to see on the program board.</Text><Select inputId="planforge-board" value={board} options={boards.map((row)=>({label:`${row.name}${row.location?` · ${row.location}`:''}`,value:row.id}))} onChange={(option)=>{setBoard(option);if(option&&!teamName)setTeamName(option.label.split(' · ')[0])}} placeholder="Choose a Jira board"/><Label labelFor="planforge-team-name">AlignIQ team name</Label><Textfield id="planforge-team-name" value={teamName} onChange={(event)=>setTeamName(event.target.value)} placeholder="Platform team"/><Inline space="space.100"><Button appearance="primary" isDisabled={!board||!teamName.trim()||isImporting} onClick={importBoard}>{isImporting?'Importing…':'Add board and import'}</Button><Button isDisabled={isImporting} onClick={loadBoards}>Refresh boards</Button></Inline>{connection.boards?.length?<Stack space="space.100"><Heading size="small">Connected boards</Heading>{connection.boards.map((connected)=><Inline key={connected.id} alignBlock="center" spread="space-between"><Text>{connected.name} → {connected.teamName}</Text><Button appearance="subtle" onClick={()=>invoke('removeBoard',{boardId:connected.id}).then(setConnection).catch((removeError)=>setError(removeError.message||'Board could not be removed.'))}>Remove</Button></Inline>)}</Stack>:<Text>No planning boards selected yet.</Text>}</Stack>:null}
    </Stack>
  );
};

ForgeReconciler.render(<Settings />);
