import * as vscode from 'vscode';
import * as fs from 'fs-extra';
import {
  generateCommitMsg,
  generateCommitMessageChatCompletionPrompt,
  getRepo
} from '../../src/generate-commit-msg';
import { getDiffStaged } from '../../src/git-utils';
import { ChatGPTAPI } from '../../src/openai-utils';
import { GeminiAPI } from '../../src/gemini-utils';
import { getMainCommitPrompt } from '../../src/prompts';
import { ConfigurationManager, ConfigKeys } from '../../src/config';
import { ProgressHandler } from '../../src/utils';

// --- Mocks ---
jest.mock('../../src/git-utils', () => ({
  getDiffStaged: jest.fn()
}));

jest.mock('../../src/prompts', () => ({
  getMainCommitPrompt: jest.fn()
}));

jest.mock('../../src/openai-utils', () => ({
  ChatGPTAPI: jest.fn()
}));

jest.mock('../../src/gemini-utils', () => ({
  GeminiAPI: jest.fn()
}));

jest.mock('../../src/config', () => {
  return {
    ConfigurationManager: {
      getInstance: jest.fn().mockReturnValue({
        getConfig: jest.fn((key: string, defaultValue: any) => {
          if (key === 'ai_provider') return 'openai';
          if (key === 'openai_api_key') return 'dummy-openai-api-key';
          return defaultValue;
        })
      })
    },
    ConfigKeys: {
      AI_PROVIDER: 'ai_provider',
      OPENAI_API_KEY: 'openai_api_key',
      GEMINI_API_KEY: 'gemini_api_key'
    }
  };
});

jest.mock('../../src/utils', () => ({
  ProgressHandler: {
    withProgress: jest.fn((title, task) => task({ report: jest.fn() }))
  }
}));

jest.mock('fs-extra', () => ({
  realpathSync: jest.fn((path: string) => path)
}));

jest.mock('vscode', () => {
  return {
    window: {},
    extensions: { getExtension: jest.fn() }
  };
});

// --- Tests ---

describe('generateCommitMessageChatCompletionPrompt', () => {
  beforeEach(() => {
    (getMainCommitPrompt as jest.Mock).mockResolvedValue([
      { role: 'system', content: 'Test prompt' }
    ]);
  });

  it('should return expected prompt messages with additional context', async () => {
    const diff = 'sample diff';
    const additionalContext = 'sample context';
    const messages = await generateCommitMessageChatCompletionPrompt(
      diff,
      additionalContext
    );

    expect(messages).toEqual([
      { role: 'system', content: 'Test prompt' },
      {
        role: 'user',
        content: `Additional context for the changes:\n${additionalContext}`
      },
      { role: 'user', content: diff }
    ]);
  });

  it('should return expected prompt messages without additional context', async () => {
    const diff = 'sample diff';
    const messages = await generateCommitMessageChatCompletionPrompt(diff);

    expect(messages).toEqual([
      { role: 'system', content: 'Test prompt' },
      { role: 'user', content: diff }
    ]);
  });
});

describe('getRepo', () => {
  it('should return the matching repository when rootUri matches', async () => {
    const fakeRepo = {
      rootUri: { fsPath: '/fake/repo' },
      inputBox: { value: '' }
    };

    // Simulate a vscode.git extension with a repository array containing fakeRepo.
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue({
      exports: {
        getAPI: jest.fn(() => ({
          repositories: [fakeRepo]
        }))
      }
    });

    const repo = await getRepo({ rootUri: { fsPath: '/fake/repo/some/path' } });
    expect(repo).toBe(fakeRepo);
  });

  it('should return the first repository if no valid rootUri is provided', async () => {
    const fakeRepo = {
      rootUri: { fsPath: '/fake/repo' },
      inputBox: { value: '' }
    };

    (vscode.extensions.getExtension as jest.Mock).mockReturnValue({
      exports: {
        getAPI: jest.fn(() => ({
          repositories: [fakeRepo]
        }))
      }
    });

    const repo = await getRepo({});
    expect(repo).toBe(fakeRepo);
  });

  it('should throw an error if the Git extension is not found', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(null);
    await expect(getRepo({ rootUri: { fsPath: '/fake/repo' } })).rejects.toThrow(
      'Git extension not found'
    );
  });
});

describe('generateCommitMsg', () => {
  beforeEach(() => {
    // Simulate successful diff retrieval
    (getDiffStaged as jest.Mock).mockResolvedValue({ diff: 'diff text', error: null });
    (getMainCommitPrompt as jest.Mock).mockResolvedValue([
      { role: 'system', content: 'Test prompt' }
    ]);
    // Simulate successful commit message generation via ChatGPTAPI
    (ChatGPTAPI as jest.Mock).mockResolvedValue('Generated commit message');
  });

  it('should insert the commit message into the active editor', async () => {
    await generateCommitMsg({ rootUri: { fsPath: '/fake/repo' } });
    expect(vscode.window.activeTextEditor.edit).toHaveBeenCalled();
  });

  it('should throw an error if no staged changes exist', async () => {
    (getDiffStaged as jest.Mock).mockResolvedValueOnce({ diff: '', error: null });
    await expect(
      generateCommitMsg({ rootUri: { fsPath: '/fake/repo' } })
    ).rejects.toThrow('No changes staged for commit');
  });

  it('should throw an error if commit message generation fails', async () => {
    (ChatGPTAPI as jest.Mock).mockResolvedValueOnce(undefined);
    await expect(
      generateCommitMsg({ rootUri: { fsPath: '/fake/repo' } })
    ).rejects.toThrow('Failed to generate commit message');
  });
});
