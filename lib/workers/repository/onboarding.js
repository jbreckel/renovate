const handlebars = require('handlebars');
const stringify = require('json-stringify-pretty-compact');

const configParser = require('../../config');

const onboardBranchName = 'renovate/configure';
const onboardPrTitle = 'Configure Renovate';

module.exports = {
  createBranch,
  ensurePr,
  getOnboardingStatus,
};

async function createBranch(config) {
  const onboardingConfig = configParser.getOnboardingConfig(config);
  const onboardingConfigString = `${stringify(onboardingConfig)}\n`;
  await config.api.commitFilesToBranch(
    onboardBranchName,
    [
      {
        name: 'renovate.json',
        contents: onboardingConfigString,
      },
    ],
    'Add renovate.json'
  );
}

async function ensurePr(config, branchUpgrades) {
  const warnings = config.warnings;
  const errors = config.errors;
  let prBody = `Welcome to [Renovate](https://keylocation.sg/our-tech/renovate)!

This is an onboarding PR to help you understand and configure Renovate before any changes are made to any \`package.json\` files. Once you close this Pull Request, we will begin keeping your dependencies up-to-date via automated Pull Requests.

---

{{BASEBRANCHDESCRIPTION}}{{PRDESCRIPTION}}

Would you like to change this? Simply edit the \`renovate.json\` in this branch and Renovate will update this Pull Request description the next time it runs.

The [Configuration](https://github.com/singapore/renovate/blob/master/docs/configuration.md) and [Configuration FAQ](https://github.com/singapore/renovate/blob/master/docs/faq.md) documents should be helpful if you wish to modify this behaviour.

---

#### Important!

You do not need to *merge* this Pull Request - renovate will begin even if it's closed *unmerged*.
In fact, you only need to add a \`renovate.json\` file to your repository if you wish to override any default settings. The file is included as part of this PR only in case you wish to change default settings before you start.

Alternatively, you can add the same configuration settings into a "renovate" section of \`package.json\`, which might be more convenient if you have only one.

If the default settings are all suitable for you, simply close this Pull Request unmerged and your first renovation will begin the next time the program is run.
`;
  if (warnings.length) {
    let prWarnings = `---\n\n### Warnings (${warnings.length})\n\n`;
    prWarnings += `Please correct - or verify that you can safely ignore - these warnings before you merge this PR.
`;
    warnings.forEach(warning => {
      prWarnings += `-   \`${warning.depName}\`: ${warning.message}\n`;
    });
    prWarnings += '\n---';
    prBody = prBody.replace('---', prWarnings);
  }
  if (errors.length) {
    let prErrors = `---\n\n## Errors (${errors.length})\n\n`;
    prErrors += `Renovate has raised errors when processing this repository that you should fix before merging or closing this PR.

Please make any fixes in _this branch_.
`;
    errors.forEach(error => {
      prErrors += `-   \`${error.depName}\`: ${error.message}\n`;
    });
    prErrors +=
      '\nFeel free to raise create a [GitHub Issue](https:/github.com/singapore/renovate/issues) to ask any questions.';
    prErrors += '\n\n---';
    prBody = prBody.replace('---', prErrors);
  }

  // Describe base branch only if it's configured
  let baseBranchDesc = '';
  if (config.baseBranch) {
    baseBranchDesc = `You have configured renovate to use branch \`${config.baseBranch}\` as base branch.\n\n`;
  }
  prBody = prBody.replace('{{BASEBRANCHDESCRIPTION}}', baseBranchDesc);

  let prDesc = `
With your current configuration, renovate will initially create the following Pull Requests:

| Pull Requests (${branchUpgrades.length}) |
| ------ |
`;
  branchUpgrades.forEach(branch => {
    const branchName = handlebars.compile(branch.branchName)(branch);
    const prTitle = handlebars.compile(branch.prTitle)(branch);
    prDesc += `| **${prTitle}**<ul>`;
    if (branch.schedule && branch.schedule.length) {
      prDesc += `<li>Schedule: ${JSON.stringify(branch.schedule)}</li>`;
    }
    prDesc += `<li>Branch name: \`${branchName}\`</li>`;
    branch.upgrades.forEach(upgrade => {
      if (upgrade.isPin) {
        prDesc += '<li>Pins ';
      } else {
        prDesc += '<li>Upgrades ';
      }
      prDesc += `[${upgrade.depName}](${upgrade.repositoryUrl}) in \`${upgrade.depType}\` from \`${upgrade.currentVersion}\` to \`${upgrade.newVersion}\``;
      prDesc += '</li>';
    });
    prDesc += '</ul> |\n';
  });
  if (branchUpgrades.length === 0) {
    // Overwrite empty content
    prDesc =
      'It looks like your repository dependencies are already up-to-date and no initial Pull Requests will be necessary.';
  }
  prBody = prBody.replace('{{PRDESCRIPTION}}', prDesc);
  // Check if existing PR exists
  const existingPr = await config.api.getBranchPr(onboardBranchName);
  if (existingPr) {
    // Check if existing PR needs updating
    if (existingPr.title === onboardPrTitle && existingPr.body === prBody) {
      config.logger.info(`${existingPr.displayNumber} does not need updating`);
      return;
    }
    // PR must need updating
    await config.api.updatePr(existingPr.number, onboardPrTitle, prBody);
    config.logger.info(`Updated ${existingPr.displayNumber}`);
    return;
  }
  const pr = await config.api.createPr(
    onboardBranchName,
    onboardPrTitle,
    prBody
  );
  config.logger.debug(`Created ${pr.displayNumber} for configuration`);
}

async function getOnboardingStatus(config) {
  config.logger.debug('Checking if repo is configured');
  // Check if repository is configured
  if (config.onboarding === false) {
    config.logger.debug('Repo onboarding is disabled');
    return true;
  }
  if (config.renovateJsonPresent) {
    config.logger.debug('Repo onboarded');
    return true;
  }
  const pr = await config.api.findPr(
    'renovate/configure',
    'Configure Renovate'
  );
  if (pr) {
    if (pr.isClosed) {
      config.logger.debug('Found closed Configure Renovate PR');
      return true;
    }
    // PR exists but hasn't been closed yet
    config.logger.debug(
      `PR #${pr.displayNumber} needs to be closed to enable renovate to continue`
    );
    return false;
  }
  await module.exports.createBranch(config);
  return false;
}
