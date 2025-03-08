import { exec } from 'child_process';
import { getDirectoryTree } from '../../src/fs-utils';

// Mock the entire child_process module and override exec with a Jest mock function
jest.mock('child_process', () => ({
  exec: jest.fn()
}));

describe('getDirectoryTree', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should resolve with stdout when no error occurs', async () => {
    const fakeOutput = 'directory tree output';
    // Set up the mock implementation for a successful exec call
    (exec as unknown as jest.Mock).mockImplementation(
      (command: string, callback: any) => {
        callback(null, fakeOutput, '');
      }
    );

    const result = await getDirectoryTree();
    expect(result).toBe(fakeOutput);
    expect(exec).toHaveBeenCalled();
  });

  it('should reject if exec returns an error', async () => {
    const error = new Error('Command failed');
    // Set up the mock implementation to simulate an error
    (exec as unknown as jest.Mock).mockImplementation(
      (command: string, callback: any) => {
        callback(error, '', '');
      }
    );

    await expect(getDirectoryTree()).rejects.toContain('Error: Command failed');
    expect(exec).toHaveBeenCalled();
  });

  it('should reject if exec returns stderr output', async () => {
    const stderrOutput = 'some error occurred';
    // Set up the mock implementation to simulate stderr output
    (exec as unknown as jest.Mock).mockImplementation(
      (command: string, callback: any) => {
        callback(null, '', stderrOutput);
      }
    );

    await expect(getDirectoryTree()).rejects.toContain(`Stderr: ${stderrOutput}`);
    expect(exec).toHaveBeenCalled();
  });
});
