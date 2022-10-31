import { WebhookClient } from 'discord.js';
import Docker from 'dockerode';
import stripAnsi from 'strip-ansi';

(async () => {
  const url = process.env.WEBHOOK;
  if (!url) {
    console.error('Missing env WEBHOOK, should be a discord webhook URL.');
    process.exit(1);
  }
  const discord = new WebhookClient({ url });

  const docker = new Docker();

  const monitorContainer = async (id: string) => {
    const container = docker.getContainer(id);
    if (!container) {
      return;
    }
    const info = await container.inspect();
    console.log({ labels: info.Config.Labels });
    // Only start the logger for containers having the "docker-discord-logger.enable" label defined.
    if (!info.Config.Labels['docker-discord-logger.enable']) {
      return;
    }
    // Optional displayname in discord for this container "docker-discord-logger.name".
    const name = info.Config.Labels['docker-discord-logger.name'] || info.Name.replace(/[^a-zA-Z0-9_-]/, '');
    // Optional avatar image url for this container "docker-discord-logger.avatar".
    const avatarURL = info.Config.Labels['docker-discord-logger.avatar'] || undefined;
    console.log('Attaching to new container ' + id + ', name: ' + info.Name + ', discord name: ' + name);
    discord.send({
      username: name,
      avatarURL,
      content: '_Starting container..._'
    });

    const stream = await container.logs({ since: 0, follow: true, stdout: true, stderr: true });
    stream.setEncoding('utf8');
    stream.on('data', (data) => {
      if (typeof data != 'string') {
        console.error('Unknown data type for data received from log of container:', { id, name, data });
        return;
      }
      data = stripAnsi(data).replace('\r\n', '\n').replace('\r', '\n');
      console.log(`${name}[${id}]: ${JSON.stringify(data)}`);
      while (data.length > 0) {
        // Allow containers to specify custom codeblock language (e.g. json) with "docker-discord-logger.codeblock".
        const pre = '```' + (info.Config.Labels['docker-discord-logger.codeblock'] || '') + '\n';
        const post = '\n```';
        discord.send({
          username: name,
          content: pre + data.slice(0, 2000 - (pre.length + post).length) + post
        });
        data = data.slice(2000);
      }
    });
    stream.on('error', (data) => {
      console.error(`An error occured while logging data from container:`, { id, name, data });
    });
    stream.on('end', () => {
      console.log('Container ' + info.Name + '[' + id + '] stopped.');
      discord.send({
        username: name,
        content: '_Container stopped._'
      });
    });
  };

  // Start monitoring all running containers
  (await docker.listContainers()).forEach((container) => monitorContainer(container.Id));

  // Start listening for new containers
  docker.getEvents(
    {
      filters: {
        type: ['container'],
        event: ['start']
      }
    },
    (err, result) => {
      if (err || !result) {
        console.error('Error registering event listener for new containers :/', err);
        process.exit(1);
      }
      result.on('data', async (data) => {
        data = JSON.parse(data.toString('utf8'));
        const id = data.id;
        monitorContainer(id);
      });
    }
  );
})();
