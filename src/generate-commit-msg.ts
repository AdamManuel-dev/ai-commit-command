import * as fs from 'fs-extra';
import { ChatCompletionMessageParam } from 'openai/resources';
import * as vscode from 'vscode';
import { ConfigKeys, ConfigurationManager } from './config';
import { getDiffStaged } from './git-utils';
import { ChatGPTAPI } from './openai-utils';
import { getMainCommitPrompt } from './prompts';
import { ProgressHandler } from './utils';
import { GeminiAPI } from './gemini-utils';
import { getDirectoryTree } from './fs-utils';
// import { getDirectoryTree } from './fs-utils';

/**
 * Generates a chat completion prompt for the commit message based on the provided diff.
 *
 * @param {string} diff - The diff string representing changes to be committed.
 * @param {string} additionalContext - Additional context for the changes.
 * @returns {Promise<Array<{ role: string, content: string }>>} - A promise that resolves to an array of messages for the chat completion.
 */
export const generateCommitMessageChatCompletionPrompt = async (
  diff: string,
  additionalContext?: string
) => {
  const INIT_MESSAGES_PROMPT = await getMainCommitPrompt();
  const chatContextAsCompletionRequest = [...INIT_MESSAGES_PROMPT];

  if (additionalContext) {
    chatContextAsCompletionRequest.push({
      role: 'user',
      content: `Additional context for the changes:\n${additionalContext}`
    });
  }

  try {
    const directoryTree = await getDirectoryTree();
    chatContextAsCompletionRequest.push({
      role: 'user',
      content: `Here is the directory structure:\n${directoryTree}`
    });
  } catch (error) {
    console.error('Error retrieving directory structure:', error);
    // Handle the error gracefully, e.g., log it or notify the user
    vscode.window.showErrorMessage(
      'Failed to retrieve directory structure. Commit message generation may be less accurate.'
    );
  }

  chatContextAsCompletionRequest.push({
    role: 'user',
    content: diff
  });
  return chatContextAsCompletionRequest;
};

/**
 * Retrieves the repository associated with the provided argument.
 *
 * @param {any} arg - The input argument containing the root URI of the repository.
 * @returns {Promise<vscode.SourceControlRepository>} - A promise that resolves to the repository object.
 */
export async function getRepo(arg) {
  const gitApi = vscode.extensions.getExtension('vscode.git')?.exports.getAPI(1);
  if (!gitApi) {
    throw new Error('Git extension not found');
  }

  if (typeof arg === 'object' && arg.rootUri) {
    const resourceUri = arg.rootUri;
    const realResourcePath: string = fs.realpathSync(resourceUri!.fsPath);
    for (let i = 0; i < gitApi.repositories.length; i++) {
      const repo = gitApi.repositories[i];
      if (realResourcePath.startsWith(repo.rootUri.fsPath)) {
        return repo;
      }
    }
  }
  return gitApi.repositories[0];
}

/**
 * Generates a commit message based on the changes staged in the repository.
 *
 * @param {any} arg - The input argument containing the root URI of the repository.
 * @returns {Promise<void>} - A promise that resolves when the commit message has been generated and inserted at the cursor in the current file.
 */
export async function generateCommitMsg(arg) {
  return ProgressHandler.withProgress('', async (progress) => {
    try {
      const configManager = ConfigurationManager.getInstance();
      const repo = await getRepo(arg);

      const aiProvider = configManager.getConfig<string>(
        ConfigKeys.AI_PROVIDER,
        'openai'
      );

      progress.report({ message: 'Getting staged changes...' });
      const { diff, error } = await getDiffStaged(repo);

      if (error) {
        throw new Error(`Failed to get staged changes: ${error}`);
      }

      if (!diff || diff === 'No changes staged.') {
        throw new Error('No changes staged for commit');
      }

      // Retrieve additional context from the SCM input box if available.
      // Instead of failing when the input box is missing, we fallback to an empty string.
      const scmInputBox = repo.inputBox;
      const additionalContext = scmInputBox ? scmInputBox.value.trim() : '';

      progress.report({
        message: additionalContext
          ? 'Analyzing changes with additional context...'
          : 'Analyzing changes...'
      });
      const messages = await generateCommitMessageChatCompletionPrompt(
        diff,
        additionalContext
      );

      progress.report({
        message: additionalContext
          ? 'Generating commit message with additional context...'
          : 'Generating commit message...'
      });
      try {
        let commitMessage: string | undefined;

        if (aiProvider === 'gemini') {
          const geminiApiKey = configManager.getConfig<string>(
            ConfigKeys.GEMINI_API_KEY
          );
          if (!geminiApiKey) {
            throw new Error('Gemini API Key not configured');
          }
          commitMessage = await GeminiAPI(messages);
        } else {
          const openaiApiKey = configManager.getConfig<string>(
            ConfigKeys.OPENAI_API_KEY
          );
          if (!openaiApiKey) {
            throw new Error('OpenAI API Key not configured');
          }
          commitMessage = await ChatGPTAPI(messages as ChatCompletionMessageParam[]);
        }

        if (commitMessage) {
          const activeEditor = vscode.window.activeTextEditor;
          if (!activeEditor) {
            throw new Error('No active text editor found');
          }
          await activeEditor.edit((editBuilder) => {
            editBuilder.insert(activeEditor.selection.active, commitMessage);
          });
        } else {
          throw new Error('Failed to generate commit message');
        }
      } catch (err) {
        let errorMessage = 'An unexpected error occurred';

        if (aiProvider === 'openai' && err.response?.status) {
          switch (err.response.status) {
            case 401:
              errorMessage = 'Invalid OpenAI API key or unauthorized access';
              break;
            case 429:
              errorMessage = 'Rate limit exceeded. Please try again later';
              break;
            case 500:
              errorMessage = 'OpenAI server error. Please try again later';
              break;
            case 503:
              errorMessage = 'OpenAI service is temporarily unavailable';
              break;
          }
        } else if (aiProvider === 'gemini') {
          errorMessage = `Gemini API error: ${err.message}`;
        }

        throw new Error(errorMessage);
      }
    } catch (error) {
      throw error;
    }
  });
}
