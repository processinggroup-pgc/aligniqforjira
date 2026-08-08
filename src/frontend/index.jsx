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
import { requestJira, view } from '@forge/bridge';

const { useCallback, useEffect, useState } = React;

const LINK_DIRECTIONS = [
  {
    label: 'This issue is blocked by the target',
    value: 'blockedBy',
  },
  {
    label: 'This issue blocks the target',
    value: 'blocks',
  },
];

const getStatusAppearance = (statusCategoryKey) => {
  if (statusCategoryKey === 'done') {
    return 'success';
  }

  if (statusCategoryKey === 'indeterminate') {
    return 'inprogress';
  }

  return 'new';
};

const describeLink = (currentIssueKey, link) => {
  /*
   * Jira stores an issue link from the perspective of the current issue. The
   * relevant relationship label and linked issue therefore depend on which
   * side of the link Jira returns. Keeping that logic here gives users a full,
   * unambiguous sentence instead of an unexplained arrow or icon.
   */
  if (link.outwardIssue) {
    return {
      id: link.id,
      linkedIssue: link.outwardIssue,
      relationship: link.type.outward,
      sentence: `${currentIssueKey} ${link.type.outward} ${link.outwardIssue.key}`,
    };
  }

  return {
    id: link.id,
    linkedIssue: link.inwardIssue,
    relationship: link.type.inward,
    sentence: `${currentIssueKey} ${link.type.inward} ${link.inwardIssue.key}`,
  };
};

const getJiraError = async (response) => {
  try {
    const body = await response.json();
    const messages = [
      ...(body.errorMessages || []),
      ...Object.values(body.errors || {}),
    ];

    if (messages.length > 0) {
      return messages.join(' ');
    }
  } catch (parseError) {
    /*
     * Some successful and failed Jira issue-link responses intentionally have
     * no JSON body. Falling back to the HTTP status still gives the user an
     * actionable message without masking the original response.
     */
    console.info('Jira returned an issue-link response without JSON', parseError);
  }

  return `Jira returned status ${response.status}.`;
};

const Dependency = ({ dependency }) => {
  const status = dependency.linkedIssue.fields?.status;
  const assignee = dependency.linkedIssue.fields?.assignee;

  return (
    <Stack space="space.100">
      <Inline alignBlock="center" spread="space-between" space="space.100">
        <Heading size="small">{dependency.sentence}</Heading>
        {status ? (
          <Lozenge appearance={getStatusAppearance(status.statusCategory?.key)}>
            {status.name}
          </Lozenge>
        ) : null}
      </Inline>
      <Text>{dependency.linkedIssue.fields?.summary || 'Summary unavailable'}</Text>
      <Text>
        Relationship: {dependency.relationship} · Owner:{' '}
        {assignee?.displayName || 'Unassigned'}
      </Text>
    </Stack>
  );
};

const App = () => {
  const [issue, setIssue] = useState(null);
  const [dependencies, setDependencies] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [targetIssueKey, setTargetIssueKey] = useState('');
  const [linkDirection, setLinkDirection] = useState(LINK_DIRECTIONS[0]);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');

  const loadDependencies = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const context = await view.getContext();
      const issueKey = context.extension?.issue?.key;

      if (!issueKey) {
        throw new Error('Jira did not provide an issue key for this panel.');
      }

      const fields = 'summary,status,assignee,issuelinks';
      const response = await requestJira(
        `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=${fields}`,
      );

      if (!response.ok) {
        throw new Error(`Jira returned status ${response.status}.`);
      }

      const currentIssue = await response.json();
      const links = currentIssue.fields?.issuelinks || [];

      setIssue(currentIssue);
      setDependencies(
        links
          .filter((link) => link.outwardIssue || link.inwardIssue)
          .map((link) => describeLink(currentIssue.key, link)),
      );
    } catch (loadError) {
      console.error('Unable to load AlignIQ dependencies', loadError);
      setError(
        'AlignIQ could not load this issue’s dependencies. Refresh the panel or ask your Jira administrator to confirm the app permissions.',
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDependencies();
  }, [loadDependencies]);

  const createDependency = async () => {
    const normalizedTargetKey = targetIssueKey.trim().toUpperCase();

    setCreateError('');
    setCreateSuccess('');

    if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(normalizedTargetKey)) {
      setCreateError('Enter a Jira issue key such as PROJ-123.');
      return;
    }

    if (normalizedTargetKey === issue.key) {
      setCreateError('An issue cannot depend on itself.');
      return;
    }

    if (
      dependencies.some(
        (dependency) => dependency.linkedIssue.key === normalizedTargetKey,
      )
    ) {
      setCreateError(
        `${normalizedTargetKey} is already linked to this issue. Review the existing relationship before adding another one.`,
      );
      return;
    }

    setIsCreating(true);

    try {
      const validationResponse = await requestJira(
        `/rest/api/3/issue/${encodeURIComponent(normalizedTargetKey)}?fields=summary`,
      );

      if (!validationResponse.ok) {
        if (validationResponse.status === 404) {
          throw new Error(
            `${normalizedTargetKey} was not found or you do not have permission to view it.`,
          );
        }

        throw new Error(await getJiraError(validationResponse));
      }

      const linkTypesResponse = await requestJira('/rest/api/3/issueLinkType');

      if (!linkTypesResponse.ok) {
        throw new Error(await getJiraError(linkTypesResponse));
      }

      const linkTypesBody = await linkTypesResponse.json();
      const blocksType = linkTypesBody.issueLinkTypes?.find(
        (linkType) => linkType.name.toLowerCase() === 'blocks',
      );

      if (!blocksType) {
        throw new Error(
          'The Jira “Blocks” link type is not enabled. Ask a Jira administrator to enable issue linking and the Blocks relationship.',
        );
      }

      /*
       * Jira names the two ends of a link inward and outward. The selected UI
       * wording is converted here so users can work with natural language while
       * Jira receives its native issue-link structure.
       */
      const currentIssue = { key: issue.key };
      const targetIssue = { key: normalizedTargetKey };
      const linkBody =
        linkDirection.value === 'blockedBy'
          ? {
              inwardIssue: targetIssue,
              outwardIssue: currentIssue,
              type: { name: blocksType.name },
            }
          : {
              inwardIssue: currentIssue,
              outwardIssue: targetIssue,
              type: { name: blocksType.name },
            };

      const createResponse = await requestJira('/rest/api/3/issueLink', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(linkBody),
      });

      if (!createResponse.ok) {
        throw new Error(await getJiraError(createResponse));
      }

      setTargetIssueKey('');
      await loadDependencies();
      setCreateSuccess(
        linkDirection.value === 'blockedBy'
          ? `${issue.key} is now blocked by ${normalizedTargetKey}.`
          : `${issue.key} now blocks ${normalizedTargetKey}.`,
      );
    } catch (createDependencyError) {
      console.error('Unable to create AlignIQ dependency', createDependencyError);
      setCreateError(
        createDependencyError.message ||
          'The dependency could not be created. Confirm your Jira project permissions and try again.',
      );
    } finally {
      setIsCreating(false);
    }
  };

  if (isLoading) {
    return (
      <Stack alignInline="center" space="space.100">
        <Spinner size="medium" />
        <Text>Loading Jira dependencies…</Text>
      </Stack>
    );
  }

  if (error) {
    return (
      <Stack space="space.200">
        <SectionMessage appearance="error" title="Dependencies unavailable">
          <Text>{error}</Text>
        </SectionMessage>
        <Button appearance="primary" onClick={loadDependencies}>
          Try again
        </Button>
      </Stack>
    );
  }

  return (
    <Stack space="space.300">
      <Inline alignBlock="center" spread="space-between" space="space.200">
        <Stack space="space.050">
          <Heading size="medium">Dependency map</Heading>
          <Text>
            {issue.key}: {issue.fields?.summary}
          </Text>
        </Stack>
        <Button appearance="subtle" onClick={loadDependencies}>
          Refresh
        </Button>
      </Inline>

      <Stack space="space.150">
        <Heading size="small">Create a dependency</Heading>
        <Label labelFor="dependency-direction">Relationship</Label>
        <Select
          inputId="dependency-direction"
          options={LINK_DIRECTIONS}
          value={linkDirection}
          onChange={(option) => setLinkDirection(option)}
          isDisabled={isCreating}
        />
        <Label labelFor="target-issue-key">Target Jira issue</Label>
        <Textfield
          id="target-issue-key"
          name="targetIssueKey"
          placeholder="PROJ-123"
          value={targetIssueKey}
          onChange={(event) => setTargetIssueKey(event.target.value.toUpperCase())}
          isDisabled={isCreating}
        />
        <HelperMessage>
          The target must be an issue you can view in this Jira site.
        </HelperMessage>
        <Button
          appearance="primary"
          iconBefore="link"
          isDisabled={isCreating || targetIssueKey.trim().length === 0}
          onClick={createDependency}
        >
          {isCreating ? 'Creating dependency…' : 'Create dependency'}
        </Button>
        {createError ? (
          <SectionMessage appearance="error" title="Dependency not created">
            <Text>{createError}</Text>
          </SectionMessage>
        ) : null}
        {createSuccess ? (
          <SectionMessage appearance="success" title="Dependency created">
            <Text>{createSuccess}</Text>
          </SectionMessage>
        ) : null}
      </Stack>

      {dependencies.length === 0 ? (
        <SectionMessage appearance="information" title="No linked dependencies yet">
          <Text>
            Add an issue link in Jira to make the relationship visible here and
            available to AlignIQ planning views.
          </Text>
        </SectionMessage>
      ) : (
        <Stack space="space.300">
          <Text>
            {dependencies.length}{' '}
            {dependencies.length === 1 ? 'linked dependency' : 'linked dependencies'}
          </Text>
          {dependencies.map((dependency) => (
            <Dependency key={dependency.id} dependency={dependency} />
          ))}
        </Stack>
      )}
    </Stack>
  );
};

ForgeReconciler.render(<App />);
