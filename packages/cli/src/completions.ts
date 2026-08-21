import { SCAFFOLD_TEMPLATES } from './scaffolds.js';

/**
 * Shell completion scripts.
 *
 * Each script is generated from the same command, flag, shell, and template
 * lists the CLI itself dispatches on, so a command that exists is completable
 * and one that does not cannot be. Hand-written scripts drift the moment a
 * command is added, and a completion offering a command the binary rejects is
 * worse than no completion at all.
 *
 * The scripts are printed, never installed. Where a shell loads completions
 * from is the user's business and differs per shell and per platform, so the
 * CLI writes to stdout and the README shows how to source it.
 */

export const COMPLETION_SHELLS = ['bash', 'zsh', 'fish', 'powershell'] as const;

export type CompletionShell = (typeof COMPLETION_SHELLS)[number];

export const CLI_COMMANDS = ['completions', 'diagnostics', 'scaffold'] as const;

export const CLI_FLAGS = ['--force', '--help', '--json', '--version'] as const;

const COMMAND_DESCRIPTIONS: Record<(typeof CLI_COMMANDS)[number], string> = {
  completions: 'Print a shell completion script',
  diagnostics: 'Print a sanitized diagnostics bundle',
  scaffold: 'Create a supported TypeScript project',
};

const commands = CLI_COMMANDS.join(' ');
const flags = CLI_FLAGS.join(' ');
const shells = COMPLETION_SHELLS.join(' ');
const templates = SCAFFOLD_TEMPLATES.join(' ');

export function isCompletionShell(value: string): value is CompletionShell {
  return (COMPLETION_SHELLS as readonly string[]).includes(value);
}

function bashScript(): string {
  return `# opencoven bash completion
# Load with: eval "$(opencoven completions bash)"
_opencoven_complete() {
  local current previous
  current="\${COMP_WORDS[COMP_CWORD]}"
  previous="\${COMP_WORDS[COMP_CWORD - 1]}"

  case "\${previous}" in
    completions)
      COMPREPLY=($(compgen -W "${shells}" -- "\${current}"))
      return 0
      ;;
    scaffold)
      COMPREPLY=($(compgen -W "${templates}" -- "\${current}"))
      return 0
      ;;
  esac

  if [[ "\${current}" == -* ]]; then
    COMPREPLY=($(compgen -W "${flags}" -- "\${current}"))
    return 0
  fi

  COMPREPLY=($(compgen -W "${commands}" -- "\${current}"))
  return 0
}

complete -F _opencoven_complete opencoven
`;
}

function zshScript(): string {
  const described = CLI_COMMANDS.map(
    (command) => `    '${command}:${COMMAND_DESCRIPTIONS[command]}'`,
  ).join('\n');

  return `#compdef opencoven
# Load with: opencoven completions zsh > "\${fpath[1]}/_opencoven"
_opencoven() {
  local -a opencoven_commands
  opencoven_commands=(
${described}
  )

  if (( CURRENT == 2 )); then
    _describe -t commands 'opencoven command' opencoven_commands
    return
  fi

  case "\${words[2]}" in
    completions)
      _values 'shell' ${shells}
      ;;
    scaffold)
      _values 'template' ${templates}
      ;;
    *)
      _values 'flag' ${flags}
      ;;
  esac
}

compdef _opencoven opencoven
`;
}

function fishScript(): string {
  const commandLines = CLI_COMMANDS.map(
    (command) =>
      `complete -c opencoven -n __fish_use_subcommand -a ${command} -d '${COMMAND_DESCRIPTIONS[command]}'`,
  ).join('\n');

  return `# opencoven fish completion
# Load with: opencoven completions fish > ~/.config/fish/completions/opencoven.fish
complete -c opencoven -f
complete -c opencoven -l help -d 'Show usage'
complete -c opencoven -l version -d 'Show the CLI version'
complete -c opencoven -l json -d 'Emit machine-readable JSON'
${commandLines}
complete -c opencoven -n '__fish_seen_subcommand_from completions' -a '${shells}'
complete -c opencoven -n '__fish_seen_subcommand_from scaffold' -a '${templates}'
complete -c opencoven -n '__fish_seen_subcommand_from scaffold' -l force -d 'Overwrite existing files'
`;
}

function powershellScript(): string {
  const quoted = (values: readonly string[]): string =>
    values.map((value) => `'${value}'`).join(', ');

  return `# opencoven PowerShell completion
# Load with: opencoven completions powershell | Out-String | Invoke-Expression
Register-ArgumentCompleter -Native -CommandName opencoven -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)

    $commands = @(${quoted(CLI_COMMANDS)})
    $flags = @(${quoted(CLI_FLAGS)})
    $shells = @(${quoted(COMPLETION_SHELLS)})
    $templates = @(${quoted(SCAFFOLD_TEMPLATES)})

    $arguments = @($commandAst.CommandElements | Select-Object -Skip 1 | ForEach-Object { $_.ToString() })
    $positional = @($arguments | Where-Object { -not $_.StartsWith('-') })
    $subcommand = if ($positional.Count -ge 1) { $positional[0] } else { '' }

    $candidates = if ($wordToComplete.StartsWith('-')) {
        $flags
    }
    elseif ($subcommand -eq 'completions') {
        $shells
    }
    elseif ($subcommand -eq 'scaffold') {
        $templates
    }
    else {
        $commands
    }

    $candidates |
        Where-Object { $_ -like "$wordToComplete*" } |
        ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
}
`;
}

const RENDERERS: Record<CompletionShell, () => string> = {
  bash: bashScript,
  zsh: zshScript,
  fish: fishScript,
  powershell: powershellScript,
};

export function renderCompletionScript(shell: CompletionShell): string {
  return RENDERERS[shell]();
}
