import { exec } from 'child_process';

export function getDirectoryTree(): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(
      "npx tree -l 8 --ignore 'node_modules,public,ios,android,fonts,assets' --directoryFirst",
      (error, stdout, stderr) => {
        if (error) {
          reject(`Error: ${error.message}`);
          return;
        }
        if (stderr) {
          reject(`Stderr: ${stderr}`);
          return;
        }
        resolve(stdout);
      }
    );
  });
}
