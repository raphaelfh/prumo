# Política de Segurança

## 🔒 Versões Suportadas

Atualmente, estamos fornecendo atualizações de segurança para as seguintes versões:

| Versão | Suportada          |
| ------ | ------------------ |
| 1.x.x  | :white_check_mark: |
| < 1.0  | :x:                |

## 🚨 Reportando uma Vulnerabilidade

**Por favor, NÃO reporte vulnerabilidades de segurança através de issues públicas no GitHub.**

### Como Reportar

Se você descobriu uma vulnerabilidade de segurança, por favor:

1. **NÃO** abra uma issue pública
2. **NÃO** discuta a vulnerabilidade publicamente
3. Entre em contato diretamente através de uma das seguintes formas:
   - **Email**: [seu-email-de-seguranca@exemplo.com] (adicione seu email aqui)
   - **GitHub Security Advisories**: Use a funcionalidade [Security Advisories](https://github.com/seu-usuario/review-hub/security/advisories) do GitHub
   - **Formulário de Contato**: [Link para formulário, se houver]

### O que Incluir no Reporte

Para nos ajudar a entender e corrigir a vulnerabilidade mais rapidamente, por favor inclua:

- **Descrição detalhada** da vulnerabilidade
- **Passos para reproduzir** o problema
- **Impacto potencial** (o que um atacante poderia fazer)
- **Sugestões de correção** (se você tiver)
- **Informações de contato** para acompanhamento

### Processo de Resposta

1. **Confirmação**: Você receberá uma confirmação de recebimento dentro de 48 horas
2. **Avaliação**: Avaliaremos a vulnerabilidade e entraremos em contato dentro de 7 dias
3. **Correção**: Trabalharemos em uma correção e manteremos você informado do progresso
4. **Disclosure**: Após a correção, podemos publicar um advisory (com sua permissão)

### Programa de Recompensas

Atualmente, **não oferecemos** um programa formal de recompensas (bug bounty). No entanto, agradecemos muito os reportes responsáveis e reconheceremos contribuidores de segurança em nosso README (com sua permissão).

## 🛡️ Medidas de Segurança

### Para Desenvolvedores

- Mantenha suas dependências atualizadas
- Execute `npm audit` regularmente
- Revise código de terceiros antes de mesclar PRs
- Use variáveis de ambiente para segredos (nunca commite credenciais)

### Para Usuários

- Mantenha o software atualizado
- Use senhas fortes
- Não compartilhe credenciais
- Reporte vulnerabilidades de forma responsável

## 📋 Checklist de Segurança

Ao contribuir com código, certifique-se de:

- [ ] Não expor credenciais ou tokens
- [ ] Validar e sanitizar todas as entradas do usuário
- [ ] Usar parâmetros preparados em queries SQL
- [ ] Implementar autenticação e autorização adequadas
- [ ] Seguir princípios de menor privilégio
- [ ] Criptografar dados sensíveis
- [ ] Implementar rate limiting onde apropriado
- [ ] Usar HTTPS em produção
- [ ] Revisar dependências por vulnerabilidades conhecidas

## 🔐 Áreas de Foco de Segurança

Estamos especialmente interessados em vulnerabilidades relacionadas a:

- Autenticação e autorização
- Injeção de SQL ou NoSQL
- Cross-Site Scripting (XSS)
- Cross-Site Request Forgery (CSRF)
- Exposição de dados sensíveis
- Quebra de controle de acesso
- Configurações incorretas de segurança
- Vulnerabilidades em dependências

## 📞 Contato

Para questões de segurança, entre em contato:

- **Email**: [seu-email-de-seguranca@exemplo.com]
- **GitHub Security Advisories**: [Link para advisories]

---

**Última atualização**: Janeiro 2025

