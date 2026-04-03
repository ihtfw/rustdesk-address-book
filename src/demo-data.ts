import * as api from "./api";

export async function loadDemoData(rootId: string) {
  // Office
  const office = await api.addFolder(
    rootId,
    "Office",
    "Main office infrastructure",
  );

  const serverRoom = await api.addFolder(
    office.id,
    "Server Room",
    "Production servers",
  );
  await api.addConnection(
    serverRoom.id,
    "DC-01",
    "Domain Controller",
    "583219047",
    "Srv@dc01!",
  );
  await api.addConnection(
    serverRoom.id,
    "FS-01",
    "File Server",
    "741058263",
    "Srv@fs01!",
  );
  await api.addConnection(
    serverRoom.id,
    "DB-01",
    "PostgreSQL Database",
    "629174385",
    "Srv@db01!",
  );
  await api.addConnection(
    serverRoom.id,
    "BACKUP-01",
    "Veeam Backup Server",
    "318740592",
    "Srv@bk01!",
  );

  const workstations = await api.addFolder(
    office.id,
    "Workstations",
    "Employee computers",
  );
  await api.addConnection(
    workstations.id,
    "Alice - PC",
    "Marketing dept",
    "204857139",
    "Ws@1234",
  );
  await api.addConnection(
    workstations.id,
    "Bob - PC",
    "Development team",
    "937164028",
    "Ws@5678",
  );
  await api.addConnection(
    workstations.id,
    "Carol - Laptop",
    "HR department",
    "518290643",
    "Ws@9012",
  );
  await api.addConnection(
    workstations.id,
    "Dave - PC",
    "Accounting",
    "846023719",
    "Ws@3456",
  );

  const network = await api.addFolder(
    office.id,
    "Network",
    "Switches and firewalls",
  );
  await api.addConnection(
    network.id,
    "FW-01",
    "Fortinet Firewall",
    "162073894",
    "Fw@adm1",
  );
  await api.addConnection(
    network.id,
    "SW-CORE",
    "Core Switch",
    "495810267",
    "Sw@core",
  );

  // Home
  const home = await api.addFolder(rootId, "Home", "Home devices");
  await api.addConnection(
    home.id,
    "Home NAS",
    "Synology DS920+",
    "753901482",
    "Nas@home",
  );
  await api.addConnection(
    home.id,
    "Living Room PC",
    "Media center",
    "382617940",
    "Hm@pc01",
  );
  await api.addConnection(
    home.id,
    "Mom's Laptop",
    "Support for mom",
    "610284753",
    "Mom@help",
  );

  // Clients
  const clients = await api.addFolder(
    rootId,
    "Clients",
    "Customer environments",
  );

  const alpha = await api.addFolder(
    clients.id,
    "Alpha Corp",
    "Contract #2024-15",
  );
  await api.addConnection(
    alpha.id,
    "Reception PC",
    "Front desk",
    "429751083",
    "Al@rcpt",
  );
  await api.addConnection(
    alpha.id,
    "Accounting-01",
    "Head accountant",
    "870592134",
    "Al@acc1",
  );
  await api.addConnection(
    alpha.id,
    "Director-PC",
    "CEO workstation",
    "253068417",
    "Al@dir1",
  );

  const beta = await api.addFolder(
    clients.id,
    "Beta LLC",
    "Monthly maintenance",
  );
  await api.addConnection(
    beta.id,
    "POS-Terminal",
    "Point of sale",
    "694137258",
    "Bt@pos1",
  );
  await api.addConnection(
    beta.id,
    "Office-PC",
    "Main office",
    "187420396",
    "Bt@ofc1",
  );

  console.log("Demo data loaded!");
}
