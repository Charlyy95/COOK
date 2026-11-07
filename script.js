const db = window.supabase.createClient(
  'https://tmwygepqyrjrqndgfhqy.supabase.co',
  'sb_publishable__QOdAIhvDh94gG5MS-vpcA_OVSPan9R'
)

// l'email du compte partagé que tu as créé dans Supabase
const EMAIL_FAMILLE = 'famille@cook.fr'

// ----- État de la page -----
const ORDRE_TYPES = ['Entrée', 'Plat', 'Dessert', 'Goûter']
let toutesLesRecettes = []
let tousLesInvites = []
let recetteOuverte = null    // recette affichée dans la page de détail
let recetteEnEdition = null  // id de la recette en cours de modification (null = création)
let inviteEnEdition = null   // id de l'invité en cours de modification (null = création)

// ----- Messages -----
let minuteur
function afficherMessage(texte, type) {
  const zone = document.getElementById('message')
  zone.textContent = texte
  zone.className = type // 'erreur' ou 'ok'
  clearTimeout(minuteur)
  minuteur = setTimeout(function () {
    zone.className = ''
    zone.textContent = ''
  }, 5000)
}

// vérifie si une valeur existe déjà dans une table (sans tenir compte des majuscules)
// ignorerId : l'id de la ligne à ne pas compter (celle qu'on est en train de modifier)
async function existeDeja(table, colonne, valeur, ignorerId) {
  const { data, error } = await db.from(table).select('id, ' + colonne)
  if (error) { console.log(error); return false }
  return data.some(function (ligne) {
    return ligne.id !== ignorerId && (ligne[colonne] || '').toLowerCase() === valeur.toLowerCase()
  })
}

// ----- Connexion -----
function entrer() {
  document.body.classList.add('connecte')
  recetteEnEdition = null
  afficherModeEdition(false)
  terminerEditionInvite()
  afficherOnglet('onglet-recettes')
  reinitialiserFormulaire()
  chargerInvites()
  chargerRecettes()
}

async function demarrer() {
  const { data } = await db.auth.getSession()
  if (data.session) entrer()
}

document.getElementById('btn-connexion').addEventListener('click', async function () {
  const champ = document.getElementById('mot-de-passe')
  const mdp = champ.value.trim() // enlève les espaces ajoutés par le clavier
  if (mdp === '') {
    afficherMessage('Tape le mot de passe de la famille.', 'erreur')
    return
  }
  const { error } = await db.auth.signInWithPassword({
    email: EMAIL_FAMILLE,
    password: mdp
  })
  if (error) {
    console.log(error)
    if (error.code === 'invalid_credentials' || error.message === 'Invalid login credentials') {
      afficherMessage('Mot de passe incorrect.', 'erreur')
    } else {
      afficherMessage('Connexion impossible : ' + error.message, 'erreur')
    }
    return
  }
  champ.value = ''
  entrer()
})

document.getElementById('mot-de-passe').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') document.getElementById('btn-connexion').click()
})

document.getElementById('btn-deconnexion').addEventListener('click', async function () {
  await db.auth.signOut()
})

// si la session se termine, on revient à l'écran de connexion
db.auth.onAuthStateChange(function (event) {
  if (event === 'SIGNED_OUT') {
    document.body.classList.remove('connecte')
    toutesLesRecettes = []
    tousLesInvites = []
    recetteOuverte = null
    recetteEnEdition = null
    inviteEnEdition = null
    document.getElementById('liste-recettes').innerHTML = ''
    document.getElementById('liste-invites').innerHTML = ''
    document.getElementById('choix-ingredients').innerHTML = ''
  }
})

// ----- Photos -----
// réduit l'image (tailleMax px au plus) et la convertit en JPEG léger
function redimensionner(fichier, tailleMax) {
  return new Promise(function (resolve) {
    const img = new Image()
    img.onload = function () {
      const ratio = Math.min(1, tailleMax / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = img.width * ratio
      canvas.height = img.height * ratio
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(resolve, 'image/jpeg', 0.8)
    }
    img.onerror = function () { resolve(null) }
    img.src = URL.createObjectURL(fichier)
  })
}

// envoie la photo dans Supabase et renvoie son adresse (ou null si ça échoue)
async function envoyerPhoto(fichier, dossier, tailleMax) {
  const blob = await redimensionner(fichier, tailleMax || 1000)
  if (!blob) return null
  const chemin = dossier + '/' + Date.now() + '.jpg'
  const { error } = await db.storage.from('photos').upload(chemin, blob, { contentType: 'image/jpeg' })
  if (error) { console.log(error); return null }
  return db.storage.from('photos').getPublicUrl(chemin).data.publicUrl
}

// ----- Onglets -----
function afficherOnglet(id) {
  // la page de détail fait partie de l'onglet "Recettes"
  const boutonActif = id === 'onglet-detail' ? 'onglet-recettes' : id
  document.querySelectorAll('.onglet').forEach(function (o) {
    o.classList.toggle('actif', o.id === id)
  })
  document.querySelectorAll('.btn-onglet').forEach(function (b) {
    b.classList.toggle('actif', b.dataset.onglet === boutonActif)
  })
}

document.querySelectorAll('.btn-onglet').forEach(function (b) {
  b.addEventListener('click', function () {
    // cliquer sur "Créer" depuis ailleurs pendant une modification = repartir de zéro
    const dejaSurCreer = document.getElementById('onglet-creer').classList.contains('actif')
    if (b.dataset.onglet === 'onglet-creer' && recetteEnEdition !== null && !dejaSurCreer) {
      quitterEdition()
    }
    afficherOnglet(b.dataset.onglet)
  })
})

// ----- Ingrédients -----
async function chargerIngredients() {
  const { data, error } = await db.from('ingredients').select('*')
  if (error) {
    console.log(error)
    afficherMessage('Impossible de charger les ingrédients.', 'erreur')
    return
  }
  const zone = document.getElementById('choix-ingredients')
  zone.innerHTML = ''
  data.forEach(function (ing) {
    const mini = ing.photo ? '<img class="mini" src="' + ing.photo + '"> ' : ''
    zone.innerHTML += '<label><input type="checkbox" value="' + ing.id + '"> ' + mini + ing.nom + ' <input type="text" class="quantite" placeholder="quantité"></label>'
  })
}

// retient les cases cochées et leurs quantités : { id: quantité }
function memoriserCoches() {
  const coches = {}
  document.querySelectorAll('#choix-ingredients input[type="checkbox"]:checked').forEach(function (cb) {
    coches[cb.value] = cb.parentElement.querySelector('.quantite').value
  })
  return coches
}

// recoche les cases retenues et remet leurs quantités
function restaurerCoches(coches) {
  Object.keys(coches).forEach(function (id) {
    const cb = document.querySelector('#choix-ingredients input[type="checkbox"][value="' + id + '"]')
    if (cb) {
      cb.checked = true
      cb.parentElement.querySelector('.quantite').value = coches[id]
    }
  })
}

document.getElementById('recherche').addEventListener('input', function () {
  const texte = this.value.toLowerCase()
  document.querySelectorAll('#choix-ingredients label').forEach(function (label) {
    label.style.display = label.textContent.toLowerCase().includes(texte) ? 'block' : 'none'
  })
})

document.getElementById('btn-ajout-ingredient').addEventListener('click', async function () {
  const bouton = this
  const nom = document.getElementById('recherche').value.trim()
  const champPhoto = document.getElementById('photo-ingredient')

  if (nom === '') {
    afficherMessage("Tape le nom de l'ingrédient dans la barre de recherche.", 'erreur')
    document.getElementById('recherche').focus()
    return
  }

  bouton.disabled = true // évite le double clic
  try {
    if (await existeDeja('ingredients', 'nom', nom)) {
      afficherMessage('Cet ingrédient existe déjà : "' + nom + '".', 'erreur')
      return
    }

    let photo = null
    if (champPhoto.files[0]) {
      photo = await envoyerPhoto(champPhoto.files[0], 'ingredients')
      if (!photo) {
        afficherMessage("La photo n'a pas pu être envoyée. Réessaie ou retire-la.", 'erreur')
        return
      }
    }

    const { error } = await db.from('ingredients').insert({ nom: nom, photo: photo })
    if (error) {
      console.log(error)
      afficherMessage("Impossible d'ajouter l'ingrédient.", 'erreur')
      return
    }

    document.getElementById('recherche').value = ''
    champPhoto.value = ''
    const avant = memoriserCoches() // les cases déjà cochées le restent
    await chargerIngredients()
    restaurerCoches(avant)
    afficherMessage('Ingrédient "' + nom + '" ajouté.', 'ok')
  } finally {
    bouton.disabled = false
  }
})

// ----- Étapes -----
function ajouterEtape(texte) {
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'etape'
  input.placeholder = 'Étape ' + (document.querySelectorAll('.etape').length + 1)
  input.value = texte || ''
  document.getElementById('liste-etapes').appendChild(input)
}

document.getElementById('btn-ajout-etape').addEventListener('click', function () {
  ajouterEtape()
})

// ----- Invités : affichage -----
// photo de profil, ou initiale du prénom s'il n'y a pas de photo
function htmlPhotoProfil(inv) {
  if (inv.photo) return '<img class="photo-profil" src="' + inv.photo + '" alt="">'
  return '<span class="photo-profil">' + inv.nom.charAt(0).toUpperCase() + '</span>'
}

// pastille cliquable : en couleur si "choisi", grisée sinon
function htmlAvatar(inv, choisi) {
  return '<div class="avatar' + (choisi ? ' choisi' : '') + '" data-id="' + inv.id + '">' +
    htmlPhotoProfil(inv) + '<small>' + inv.nom + '</small></div>'
}

async function chargerInvites() {
  const { data, error } = await db.from('invites').select('*').order('nom')
  if (error) {
    console.log(error)
    afficherMessage('Impossible de charger les invités.', 'erreur')
    return
  }
  tousLesInvites = data
  afficherInvites()
  afficherSelecteurCreation()
  afficherSelecteurDetail()
}

// onglet "Invités" : une carte par invité
function afficherInvites() {
  const zone = document.getElementById('liste-invites')
  if (tousLesInvites.length === 0) {
    zone.innerHTML = '<p class="vide">Aucun invité pour l\'instant.</p>'
    return
  }
  zone.innerHTML = tousLesInvites.map(function (inv) {
    return '<div class="carte-invite" data-id="' + inv.id + '">' +
      htmlPhotoProfil(inv) + '<strong>' + inv.nom + '</strong>' +
      '<div><button type="button" class="btn-modifier-invite">Modifier</button> ' +
      '<button type="button" class="btn-supprimer-invite">Supprimer</button></div></div>'
  }).join('')
}

// formulaire "Créer" : les invités déjà choisis restent choisis quand on réaffiche
function afficherSelecteurCreation() {
  const zone = document.getElementById('selecteur-creation')
  const choisis = Array.from(zone.querySelectorAll('.avatar.choisi')).map(function (el) {
    return Number(el.dataset.id)
  })
  if (tousLesInvites.length === 0) {
    zone.innerHTML = '<p class="vide-invites">Aucun invité pour l\'instant : crée-les dans l\'onglet Invités.</p>'
    return
  }
  zone.innerHTML = tousLesInvites.map(function (inv) {
    return htmlAvatar(inv, choisis.includes(inv.id))
  }).join('')
}

// page de détail : en couleur = a déjà mangé ce plat
function afficherSelecteurDetail() {
  const zone = document.getElementById('selecteur-detail')
  if (!recetteOuverte) { zone.innerHTML = ''; return }
  if (tousLesInvites.length === 0) {
    zone.innerHTML = '<p class="vide-invites">Aucun invité pour l\'instant : crée-les dans l\'onglet Invités.</p>'
    return
  }
  const ids = recetteOuverte.recette_invites.map(function (x) { return x.invite_id })
  zone.innerHTML = tousLesInvites.map(function (inv) {
    return htmlAvatar(inv, ids.includes(inv.id))
  }).join('')
}

// clic sur une photo dans le formulaire "Créer" : on (dé)sélectionne, c'est enregistré avec la recette
document.getElementById('selecteur-creation').addEventListener('click', function (e) {
  const avatar = e.target.closest('.avatar')
  if (avatar) avatar.classList.toggle('choisi')
})

// clic sur une photo dans la page de détail : on ajoute ou on retire tout de suite
document.getElementById('selecteur-detail').addEventListener('click', async function (e) {
  const avatar = e.target.closest('.avatar')
  const r = recetteOuverte
  if (!avatar || !r) return
  const inviteId = Number(avatar.dataset.id)
  const dejaMange = r.recette_invites.some(function (x) { return x.invite_id === inviteId })

  if (dejaMange) {
    // .select() renvoie les lignes supprimées : vide = rien n'a été supprimé
    const { data, error } = await db.from('recette_invites').delete()
      .eq('recette_id', r.id).eq('invite_id', inviteId).select()
    if (error || data.length === 0) {
      console.log(error)
      afficherMessage('Impossible de retirer cet invité.', 'erreur')
      return
    }
    r.recette_invites = r.recette_invites.filter(function (x) { return x.invite_id !== inviteId })
  } else {
    const { error } = await db.from('recette_invites').insert({ recette_id: r.id, invite_id: inviteId })
    if (error) {
      console.log(error)
      afficherMessage("Impossible d'ajouter cet invité.", 'erreur')
      return
    }
    r.recette_invites.push({ invite_id: inviteId })
  }
  afficherSelecteurDetail()
})

// ----- Invités : créer, modifier, supprimer -----
function terminerEditionInvite() {
  inviteEnEdition = null
  document.getElementById('nom-invite').value = ''
  document.getElementById('photo-invite').value = ''
  document.getElementById('btn-invite').textContent = "Ajouter l'invité"
  document.getElementById('btn-annuler-invite').hidden = true
}

document.getElementById('btn-annuler-invite').addEventListener('click', terminerEditionInvite)

document.getElementById('btn-invite').addEventListener('click', async function () {
  const bouton = this
  const idEdition = inviteEnEdition
  const nom = document.getElementById('nom-invite').value.trim()
  const champPhoto = document.getElementById('photo-invite')

  if (nom === '') {
    afficherMessage("Tape le prénom de l'invité.", 'erreur')
    document.getElementById('nom-invite').focus()
    return
  }

  bouton.disabled = true // évite le double clic
  try {
    if (await existeDeja('invites', 'nom', nom, idEdition)) {
      afficherMessage('Un invité "' + nom + '" existe déjà.', 'erreur')
      return
    }

    // la nouvelle photo si on en a choisi une, sinon l'ancienne
    const ancien = idEdition !== null
      ? tousLesInvites.find(function (x) { return x.id === idEdition })
      : null
    let photo = ancien ? ancien.photo : null
    if (champPhoto.files[0]) {
      photo = await envoyerPhoto(champPhoto.files[0], 'invites', 300)
      if (!photo) {
        afficherMessage("La photo n'a pas pu être envoyée. Réessaie ou retire-la.", 'erreur')
        return
      }
    }

    if (idEdition !== null) {
      const { data, error } = await db.from('invites').update({ nom: nom, photo: photo }).eq('id', idEdition).select()
      if (error || data.length === 0) {
        console.log(error)
        afficherMessage("Impossible de modifier l'invité.", 'erreur')
        return
      }
    } else {
      const { error } = await db.from('invites').insert({ nom: nom, photo: photo })
      if (error) {
        console.log(error)
        afficherMessage("Impossible d'ajouter l'invité.", 'erreur')
        return
      }
    }

    terminerEditionInvite()
    await chargerInvites()
    afficherMessage(idEdition !== null ? 'Invité "' + nom + '" modifié.' : 'Invité "' + nom + '" ajouté.', 'ok')
  } finally {
    bouton.disabled = false
  }
})

// boutons "Modifier" et "Supprimer" des cartes d'invités
document.getElementById('liste-invites').addEventListener('click', async function (e) {
  const carte = e.target.closest('.carte-invite')
  if (!carte) return
  const id = Number(carte.dataset.id)
  const inv = tousLesInvites.find(function (x) { return x.id === id })
  if (!inv) return

  if (e.target.classList.contains('btn-modifier-invite')) {
    inviteEnEdition = id
    document.getElementById('nom-invite').value = inv.nom
    document.getElementById('photo-invite').value = ''
    document.getElementById('btn-invite').textContent = 'Enregistrer les modifications'
    document.getElementById('btn-annuler-invite').hidden = false
    window.scrollTo(0, 0)
  }

  if (e.target.classList.contains('btn-supprimer-invite')) {
    if (!confirm('Supprimer ' + inv.nom + ' ? Cette personne sera retirée de toutes les recettes.')) return
    const { data, error } = await db.from('invites').delete().eq('id', id).select()
    if (error || data.length === 0) {
      console.log(error)
      afficherMessage("Impossible de supprimer l'invité.", 'erreur')
      return
    }
    if (inviteEnEdition === id) terminerEditionInvite()
    await chargerInvites()
    await chargerRecettes() // les listes "a déjà mangé" des recettes ont changé
    afficherMessage(inv.nom + ' a été supprimé(e).', 'ok')
  }
})

// ----- Recettes : chargement, filtres, tri, affichage -----
async function chargerRecettes() {
  const { data, error } = await db
    .from('recettes')
    .select('*, recette_ingredients(ingredient_id, quantite, ingredients(nom)), recette_invites(invite_id)')
    .order('id', { ascending: false })
  if (error) {
    console.log(error)
    afficherMessage('Impossible de charger les recettes.', 'erreur')
    return
  }
  toutesLesRecettes = data
  afficherRecettes()
}

// "Plat · 30 min · Facile"
function texteInfos(r) {
  const infos = []
  if (r.type) infos.push(r.type)
  if (r.temps) infos.push(r.temps + ' min')
  if (r.difficulte) infos.push(r.difficulte)
  return infos.join(' · ')
}

function afficherRecettes() {
  const texte = document.getElementById('recherche-recette').value.toLowerCase()
  const type = document.getElementById('filtre-type').value
  const tempsMax = Number(document.getElementById('filtre-temps').value)
  const difficulte = document.getElementById('filtre-difficulte').value
  const tri = document.getElementById('tri').value

  // 1. filtres (une recette sans temps est exclue quand on filtre par temps)
  const liste = toutesLesRecettes.filter(function (r) {
    const noms = r.recette_ingredients.map(function (ri) { return ri.ingredients.nom }).join(' ')
    const cherche = (r.titre + ' ' + (r.auteur || '') + ' ' + noms).toLowerCase()
    if (!cherche.includes(texte)) return false
    if (type !== '' && r.type !== type) return false
    if (difficulte !== '' && r.difficulte !== difficulte) return false
    if (tempsMax > 0 && (!r.temps || r.temps > tempsMax)) return false
    return true
  })

  // 2. tri (par défaut : les plus récentes, ordre de chargement)
  if (tri === 'az') {
    liste.sort(function (a, b) { return a.titre.localeCompare(b.titre, 'fr') })
  } else if (tri === 'temps') {
    liste.sort(function (a, b) { return (a.temps || 99999) - (b.temps || 99999) })
  } else if (tri === 'type') {
    liste.sort(function (a, b) {
      const ia = ORDRE_TYPES.indexOf(a.type)
      const ib = ORDRE_TYPES.indexOf(b.type)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })
  }

  // 3. affichage : cartes légères, le détail s'ouvre au clic
  const zone = document.getElementById('liste-recettes')
  if (liste.length === 0) {
    zone.innerHTML = '<p class="vide">Aucune recette trouvée.</p>'
    return
  }
  zone.innerHTML = ''
  liste.forEach(function (r) {
    let html = '<div class="recette' + (r.photo ? ' avec-photo' : '') + '" data-id="' + r.id + '">'
    if (r.photo) html += '<img class="photo" src="' + r.photo + '">'
    html += '<h4>' + r.titre + '</h4>'
    const infos = texteInfos(r)
    if (infos !== '') html += '<p class="infos">' + infos + '</p>'
    if (r.auteur) html += '<p class="auteur">Ajoutée par ' + r.auteur + '</p>'
    html += '</div>'
    zone.innerHTML += html
  })
}

// à chaque changement de la recherche, d'un filtre ou du tri, on réaffiche
const idsFiltres = ['recherche-recette', 'filtre-type', 'filtre-temps', 'filtre-difficulte', 'tri']
idsFiltres.forEach(function (id) {
  document.getElementById(id).addEventListener('input', afficherRecettes)
})

// clic sur une carte : on ouvre son détail
document.getElementById('liste-recettes').addEventListener('click', function (e) {
  const carte = e.target.closest('.recette')
  if (carte) afficherDetail(Number(carte.dataset.id))
})

// ----- Page de détail -----
function afficherDetail(id) {
  const r = toutesLesRecettes.find(function (x) { return x.id === id })
  if (!r) return
  recetteOuverte = r

  let html = ''
  if (r.photo) html += '<img class="photo-detail" src="' + r.photo + '">'
  html += '<h2>' + r.titre + '</h2>'
  const infos = texteInfos(r)
  if (infos !== '') html += '<p class="infos">' + infos + '</p>'
  if (r.auteur) html += '<p class="auteur">Ajoutée par ' + r.auteur + '</p>'
  if (r.cuisson) html += '<p class="detail">Cuisson : ' + r.cuisson + '</p>'

  html += '<h3>Ingrédients</h3><ul>'
  r.recette_ingredients.forEach(function (ri) {
    html += '<li>' + (ri.quantite ? ri.quantite + ' ' : '') + ri.ingredients.nom + '</li>'
  })
  html += '</ul>'

  const etapes = (r.etapes || '').split('\n').filter(function (e) { return e !== '' })
  if (etapes.length > 0) {
    html += '<h3>Étapes</h3><ol>'
    etapes.forEach(function (e) { html += '<li>' + e + '</li>' })
    html += '</ol>'
  }

  document.getElementById('detail-contenu').innerHTML = html
  afficherSelecteurDetail()
  afficherOnglet('onglet-detail')
  window.scrollTo(0, 0)
}

document.getElementById('btn-retour').addEventListener('click', function () {
  afficherOnglet('onglet-recettes')
})

// ----- Supprimer une recette -----
document.getElementById('btn-supprimer').addEventListener('click', async function () {
  const bouton = this
  const r = recetteOuverte
  if (!r) return
  if (!confirm('Supprimer définitivement la recette "' + r.titre + '" ?')) return

  bouton.disabled = true
  try {
    // .select() renvoie les lignes supprimées : vide = rien n'a été supprimé
    const { data, error } = await db.from('recettes').delete().eq('id', r.id).select()
    if (error || data.length === 0) {
      console.log(error)
      afficherMessage('Impossible de supprimer la recette.', 'erreur')
      return
    }
    recetteOuverte = null
    await chargerRecettes()
    afficherOnglet('onglet-recettes')
    afficherMessage('Recette "' + r.titre + '" supprimée.', 'ok')
  } finally {
    bouton.disabled = false
  }
})

// ----- Formulaire : création et modification -----
function afficherModeEdition(actif, titre) {
  document.getElementById('bandeau-edition').style.display = actif ? 'flex' : 'none'
  document.getElementById('texte-edition').textContent = actif ? 'Modification de "' + titre + '"' : ''
  document.getElementById('btn-recette').textContent = actif ? 'Enregistrer les modifications' : 'Enregistrer la recette'
  // en modification, les invités se gèrent depuis la page de la recette
  document.getElementById('bloc-invites-creation').style.display = actif ? 'none' : 'block'
}

// vide le formulaire (le prénom est gardé dans le navigateur pour ne pas le retaper)
async function reinitialiserFormulaire() {
  document.getElementById('titre').value = ''
  document.getElementById('auteur').value = localStorage.getItem('auteur') || ''
  document.getElementById('type').value = ''
  document.getElementById('difficulte').value = ''
  document.getElementById('temps').value = ''
  document.getElementById('cuisson').value = ''
  document.getElementById('photo-recette').value = ''
  document.getElementById('recherche').value = ''
  document.getElementById('liste-etapes').innerHTML = ''
  ajouterEtape()
  document.getElementById('selecteur-creation').innerHTML = '' // plus aucun invité choisi
  afficherSelecteurCreation()
  await chargerIngredients()
}

async function quitterEdition() {
  recetteEnEdition = null
  afficherModeEdition(false)
  await reinitialiserFormulaire()
}

document.getElementById('btn-annuler-edition').addEventListener('click', async function () {
  const id = recetteEnEdition
  await quitterEdition()
  if (id !== null) afficherDetail(id)
  else afficherOnglet('onglet-recettes')
})

// "Modifier" : on remplit le formulaire avec la recette ouverte
document.getElementById('btn-modifier').addEventListener('click', async function () {
  const r = recetteOuverte
  if (!r) return

  await reinitialiserFormulaire() // repart d'un formulaire propre
  recetteEnEdition = r.id
  afficherModeEdition(true, r.titre)

  document.getElementById('titre').value = r.titre
  document.getElementById('auteur').value = r.auteur || ''
  document.getElementById('type').value = r.type || ''
  document.getElementById('difficulte').value = r.difficulte || ''
  document.getElementById('temps').value = r.temps || ''
  document.getElementById('cuisson').value = r.cuisson || ''

  // une ligne par étape, plus une ligne vide pour en ajouter
  document.getElementById('liste-etapes').innerHTML = ''
  ;(r.etapes || '').split('\n').filter(function (e) { return e !== '' }).forEach(function (e) {
    ajouterEtape(e)
  })
  ajouterEtape()

  // ingrédients : cases cochées et quantités
  const coches = {}
  r.recette_ingredients.forEach(function (ri) {
    coches[ri.ingredient_id] = ri.quantite || ''
  })
  restaurerCoches(coches)

  afficherOnglet('onglet-creer')
})

// ----- Enregistrer (création ou modification) -----
document.getElementById('btn-recette').addEventListener('click', async function () {
  const bouton = this
  const idEdition = recetteEnEdition
  const titre = document.getElementById('titre').value.trim()
  const auteur = document.getElementById('auteur').value.trim()
  const type = document.getElementById('type').value
  const difficulte = document.getElementById('difficulte').value
  const temps = document.getElementById('temps').value.trim()
  const cuisson = document.getElementById('cuisson').value.trim()
  const champPhoto = document.getElementById('photo-recette')

  // le temps est un nombre entier de minutes, ou rien (null)
  const tempsNombre = temps === '' ? null : parseInt(temps, 10)

  const listeEtapes = Array.from(document.querySelectorAll('.etape'))
    .map(function (e) { return e.value.trim() })
    .filter(function (t) { return t !== '' })

  const coches = Array.from(document.querySelectorAll('#choix-ingredients input[type="checkbox"]:checked'))

  // invités choisis dans le formulaire (création seulement)
  const invitesChoisis = Array.from(document.querySelectorAll('#selecteur-creation .avatar.choisi'))
    .map(function (el) { return Number(el.dataset.id) })

  // 1. vérifications des champs obligatoires
  if (titre === '') {
    afficherMessage('Le titre est obligatoire.', 'erreur')
    document.getElementById('titre').focus()
    return
  }
  if (auteur === '') {
    afficherMessage('Indique ton prénom.', 'erreur')
    document.getElementById('auteur').focus()
    return
  }
  if (type === '') {
    afficherMessage('Choisis le type de plat.', 'erreur')
    document.getElementById('type').focus()
    return
  }
  if (temps !== '' && (isNaN(tempsNombre) || tempsNombre <= 0)) {
    afficherMessage('Le temps doit être un nombre de minutes.', 'erreur')
    document.getElementById('temps').focus()
    return
  }
  if (coches.length === 0) {
    afficherMessage('Coche au moins un ingrédient.', 'erreur')
    return
  }

  bouton.disabled = true // évite le double clic
  try {
    // 2. le titre existe-t-il déjà (hors la recette qu'on modifie) ?
    if (await existeDeja('recettes', 'titre', titre, idEdition)) {
      afficherMessage('Une recette "' + titre + '" existe déjà.', 'erreur')
      document.getElementById('titre').focus()
      return
    }

    const ancienne = idEdition !== null
      ? toutesLesRecettes.find(function (x) { return x.id === idEdition })
      : null

    // 3. la photo : la nouvelle si on en a choisi une, sinon l'ancienne
    let photo = ancienne ? ancienne.photo : null
    if (champPhoto.files[0]) {
      photo = await envoyerPhoto(champPhoto.files[0], 'recettes')
      if (!photo) {
        afficherMessage("La photo n'a pas pu être envoyée. Réessaie ou retire-la.", 'erreur')
        return
      }
    }

    // 4. la recette
    const fiche = {
      titre: titre,
      auteur: auteur,
      etapes: listeEtapes.join('\n'),
      photo: photo,
      type: type,
      temps: tempsNombre,
      difficulte: difficulte || null,
      cuisson: cuisson || null
    }

    let recetteId
    if (idEdition !== null) {
      // modification
      const { data, error } = await db.from('recettes').update(fiche).eq('id', idEdition).select()
      if (error || data.length === 0) {
        console.log(error)
        afficherMessage('Impossible de modifier la recette.', 'erreur')
        return
      }
      recetteId = idEdition

      // on supprime les anciennes lignes d'ingrédients (on vérifie qu'elles ont bien disparu)
      const { data: supprimes, error: erreurSuppr } = await db
        .from('recette_ingredients')
        .delete()
        .eq('recette_id', idEdition)
        .select()
      if (erreurSuppr || supprimes.length !== ancienne.recette_ingredients.length) {
        console.log(erreurSuppr)
        afficherMessage("Les anciens ingrédients n'ont pas pu être remplacés.", 'erreur')
        return
      }
    } else {
      // création
      const { data, error } = await db.from('recettes').insert(fiche).select()
      if (error) {
        console.log(error)
        afficherMessage("Impossible d'enregistrer la recette.", 'erreur')
        return
      }
      recetteId = data[0].id
    }

    // 5. les ingrédients cochés, avec leur quantité
    const lignes = coches.map(function (cb) {
      return {
        recette_id: recetteId,
        ingredient_id: Number(cb.value),
        quantite: cb.parentElement.querySelector('.quantite').value.trim()
      }
    })
    const { error: erreur2 } = await db.from('recette_ingredients').insert(lignes)
    if (erreur2) {
      console.log(erreur2)
      afficherMessage("La recette est enregistrée, mais ses ingrédients n'ont pas pu l'être.", 'erreur')
      return
    }

    // 6. les invités qui ont déjà mangé ce plat (création seulement)
    if (idEdition === null && invitesChoisis.length > 0) {
      const lignesInvites = invitesChoisis.map(function (id) {
        return { recette_id: recetteId, invite_id: id }
      })
      const { error: erreur3 } = await db.from('recette_invites').insert(lignesInvites)
      if (erreur3) {
        console.log(erreur3)
        afficherMessage("La recette est enregistrée, mais la liste des invités n'a pas pu l'être.", 'erreur')
        return
      }
    }

    // 7. remise à zéro, puis retour sur la recette (modification) ou la liste (création)
    if (idEdition === null) localStorage.setItem('auteur', auteur)
    await quitterEdition()
    await chargerRecettes()
    if (idEdition !== null) {
      afficherDetail(idEdition)
      afficherMessage('Recette "' + titre + '" modifiée.', 'ok')
    } else {
      afficherOnglet('onglet-recettes')
      afficherMessage('Recette "' + titre + '" enregistrée !', 'ok')
    }
  } finally {
    bouton.disabled = false
  }
})

// ----- Démarrage -----
demarrer()